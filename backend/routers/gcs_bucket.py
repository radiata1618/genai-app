from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Response
from fastapi.responses import StreamingResponse
import os
import io
import mimetypes
from pathlib import Path
from typing import List, Optional
from google.cloud import storage
from pydantic import BaseModel

router = APIRouter(
    tags=["gcs_bucket"],
)

# 対象のバケット名。環境変数から取得し、無ければデフォルトを使用
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_COWORK_OUTPUT", "claude-cowork-output")

def get_storage_client():
    # サービスアカウントキーファイルがあれば使用し、無ければデフォルトの認証を使用
    key_path = Path(__file__).parent.parent / "key.json"
    if key_path.exists():
        return storage.Client.from_service_account_json(str(key_path))
    else:
        return storage.Client()

class CreateFolderRequest(BaseModel):
    parent_path: str  # 例: "folder1/" または空文字 ""
    folder_name: str  # 例: "subfolder"

class DeleteRequest(BaseModel):
    path: str  # 例: "folder1/file.txt" または "folder1/subfolder/"
    type: str  # "file" または "folder"

@router.get("/gcs/files")
def list_files(path: str = ""):
    """
    指定されたプレフィックス（フォルダパス）配下のファイルとフォルダの一覧を取得します。
    """
    if not GCS_BUCKET_NAME:
        raise HTTPException(status_code=500, detail="GCS_BUCKET_NAME_COWORK_OUTPUT is not configured")

    try:
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        
        # delimiter="/" を指定して一階層のみを取得
        blobs = bucket.list_blobs(prefix=path, delimiter="/")
        
        items = []
        
        # blobsのイテレーションを実行して内部のprefixes（フォルダ）も取得できるようにする
        for blob in blobs:
            # 指定された親フォルダ自体は除外する
            if blob.name == path:
                continue
                
            # フォルダプレフィックスを模した空ファイル（末尾が/でサイズ0）も除外する（prefixesで処理するため）
            if blob.name.endswith("/"):
                continue

            # ファイル名のみを取り出す
            name = blob.name
            if path:
                name = blob.name[len(path):]

            items.append({
                "type": "file",
                "name": name,
                "path": blob.name,
                "size": blob.size,
                "updated": blob.updated.isoformat() if blob.updated else None,
                "content_type": blob.content_type
            })

        # サブフォルダ（prefixes）を処理する
        for prefix in blobs.prefixes:
            # prefix は "parent/sub/" のようになっている
            name = prefix
            if path:
                name = prefix[len(path):]
            name = name.rstrip("/")

            items.append({
                "type": "folder",
                "name": name,
                "path": prefix,
                "size": 0,
                "updated": None,
                "content_type": None
            })

        # フォルダ、ファイルの順で名前順にソートする
        items.sort(key=lambda x: (0 if x["type"] == "folder" else 1, x["name"].lower()))
        return items
    except Exception as e:
        print(f"GCS List files error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/gcs/create-folder")
def create_folder(req: CreateFolderRequest):
    """
    GCS上に仮想フォルダを作成します（末尾が '/' のサイズ0のオブジェクトを作成）。
    """
    try:
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        
        # フォルダのパスを構成（末尾に必ずスラッシュを付与）
        folder_path = f"{req.parent_path}{req.folder_name}"
        if not folder_path.endswith("/"):
            folder_path += "/"
            
        blob = bucket.blob(folder_path)
        
        # 空の文字列でアップロードして、サイズ0のオブジェクトを作る
        blob.upload_from_string(b"", content_type="application/x-directory")
        
        return {"status": "success", "path": folder_path}
    except Exception as e:
        print(f"GCS Create folder error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/gcs/upload")
async def upload_file(
    path: str = Form(""), # アップロード先フォルダのパス。例: "folder1/" または ""
    file: UploadFile = File(...)
):
    """
    ファイルをGCSの指定フォルダにアップロードします。同名ファイルがある場合は上書き（更新）されます。
    """
    try:
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        
        blob_path = f"{path}{file.filename}"
        blob = bucket.blob(blob_path)
        
        # MIMEタイプの決定
        content_type = file.content_type
        if not content_type:
            content_type, _ = mimetypes.guess_type(file.filename)
            if not content_type:
                content_type = "application/octet-stream"
                
        # アップロードを実行
        blob.upload_from_file(file.file, content_type=content_type)
        
        return {"status": "success", "path": blob_path, "filename": file.filename}
    except Exception as e:
        print(f"GCS Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/gcs/delete")
def delete_item(req: DeleteRequest):
    """
    ファイルまたはフォルダを削除します。フォルダの場合は配下の全オブジェクトを再逆的に削除します。
    """
    try:
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        
        if req.type == "folder":
            # フォルダの場合は、指定されたプレフィックス配下の全blobを取得して削除
            if not req.path.endswith("/"):
                # 安全のため、フォルダパスの末尾には必ずスラッシュを補完
                folder_path = req.path + "/"
            else:
                folder_path = req.path
                
            blobs = bucket.list_blobs(prefix=folder_path)
            deleted_count = 0
            for blob in blobs:
                blob.delete()
                deleted_count += 1
            return {"status": "success", "message": f"Deleted folder and {deleted_count} objects"}
        else:
            # ファイルの場合は単一のblobを削除
            blob = bucket.blob(req.path)
            if not blob.exists():
                raise HTTPException(status_code=404, detail="File not found")
            blob.delete()
            return {"status": "success", "message": f"Deleted file {req.path}"}
    except Exception as e:
        print(f"GCS Delete error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/gcs/view")
def view_file(path: str):
    """
    GCS上のファイルをダウンロードしてブラウザでインライン表示（プレビュー）できるようにレスポンスを返します。
    """
    try:
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(path)
        
        if not blob.exists():
            raise HTTPException(status_code=404, detail="File not found")
            
        # ファイルの中身をストリームとして取得
        file_stream = io.BytesIO()
        blob.download_to_file(file_stream)
        file_stream.seek(0)
        
        # Content-Typeの設定
        content_type = blob.content_type
        if not content_type:
            content_type, _ = mimetypes.guess_type(path)
            if not content_type:
                content_type = "application/octet-stream"
                
        # 日本語ファイル名などのエンコーディング対応
        filename = Path(path).name
        
        # HTMLやPDFなどの場合、ブラウザでインライン表示（プレビュー）させるために Content-Disposition を指定
        headers = {
            "Content-Disposition": f"inline; filename*=UTF-8''{filename}"
        }
        
        return StreamingResponse(file_stream, media_type=content_type, headers=headers)
    except Exception as e:
        print(f"GCS View error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
