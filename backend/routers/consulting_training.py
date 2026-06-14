from fastapi import (
    APIRouter,
    HTTPException,
    Depends,
    status,
    UploadFile,
    File
)
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import datetime
import uuid
import json
import os

from google.genai import types
from google.cloud import firestore

from services.ai_shared import (
    get_genai_client,
    get_firestore_client,
    PROJECT_ID,
    LOCATION,
    GCS_BUCKET_NAME
)

from config import (
    GEMINI_FLASH_MODEL,
    GEMINI_CHAT_MODEL,
    GEMINI_PRO_MODEL
)

router = APIRouter(
    prefix="/consulting/training",
    tags=["consulting_training"],
)

# --- Firestore コレクション設定 ---
CONFIG_COLLECTION = "consulting_settings"
CONFIG_DOC_ID = "mtg_training_config"
TASKS_COLLECTION = "consulting_training_tasks"

# --- デフォルトのシステム指示と評価ルーブリック ---
DEFAULT_SYSTEM_INSTRUCTION = """あなたはData・AI領域の専門コンサルタントチームの長であり、部下の会話能力を鍛える一流のコミュニケーションコーチです。
提出された会議音声から、コンサルタント（特に「牛越（うしこし）」さん、もしくは話者）の会話スタイルを分析し、定量的かつ客観的に評価してください。
話し方の明瞭さ、フィラーのコントロール、相手の発言の咀嚼と要約力、論理的な構成、心理的安全性の構築に注目し、具体的な改善ポイントをフィードバックしてください。"""

DEFAULT_RUBRIC_DEFINITION = """【評価基準（ルーブリック）】
各指標を1〜5点で評価します。

1. 滑舌と明瞭さ (clarity)
   - 5点: 発音が極めて明瞭で、適切な速度と間で、自信と信頼感のある話し方ができている。
   - 3点: 全体として伝わるが、早口になったり、一部もごもごする箇所がある。
   - 1点: 早口すぎる、またはもごもごしており、聞き取りに大きな支障がある。

2. フィラー抑制 (filler)
   - 5点: 「あの」「ええと」「ちょっと」「まあ」等の無駄な雑音（フィラー）がほぼなく、沈黙をコントロールできている。
   - 3点: 数分に数回程度のフィラーがあり、聞き手にとって少し意識されるレベル。
   - 1点: ほぼすべての文頭や合間にフィラーが挟まり、対話のテンポや専門家としての信頼感を損ねている。

3. 要約・咀嚼力 (synthesis)
   - 5点: 相手の発言をしっかりと受け止め（アクティブリスニング）、要点を構造化して咀嚼・要約し、認識合わせを行っている。
   - 3点: 相手の発言を繰り返してはいるが、要約が不十分または自身の論点への移行が強引。
   - 1点: 相手の話を咀嚼せず、自分の意見を一方的に話し、認識の齟齬を引き起こしている。

4. 論理的構成力 (logic)
   - 5点: 結論ファースト（PREP法）が徹底され、論拠との接続が明快かつ簡潔で、説得力がある。
   - 3点: 結論はあるが、説明が冗長であったり、論理の接続がやや弱い。
   - 1点: 話の終着点が見えず、論理構成が破綻しており何を主張しているか不明瞭。

5. 対話態度と配慮 (empathy)
   - 5点: クッション言葉を効果的に使い、相手への敬意と配慮に富んだ丁寧な対話。心理的安全性を築いている。
   - 3点: 一般的なビジネス敬語レベルで、可もなく不可もない対応。
   - 1点: 相手の意見を否定するような強い言い回しや、対話の姿勢として不適切な配慮の欠如がある。"""

# --- Pydantic スキーマ定義（FastAPI リクエスト / レスポンス用） ---

class TrainingConfigUpdateRequest(BaseModel):
    system_instruction: str
    rubric_definition: str

class TrainingConfigResponse(BaseModel):
    system_instruction: str
    rubric_definition: str
    updated_at: Optional[datetime.datetime] = None

class ConfigChatRequest(BaseModel):
    user_message: str
    current_system_instruction: str
    current_rubric_definition: str

class ConfigChatResponse(BaseModel):
    assistant_response: str
    proposed_system_instruction: str
    proposed_rubric_definition: str

class TrainingReviewCreateRequest(BaseModel):
    media_filename: str
    gcs_path: str

class TopicEvaluation(BaseModel):
    topic_title: str = Field(..., description="トピックまたは議論セグメントのタイトル")
    time_range: str = Field(..., description="このセグメントの時間帯（例: '02:15 - 05:40'）")
    summary: str = Field(..., description="このセグメントでの会話要約")
    scores: Dict[str, int] = Field(..., description="各指標のスコア(1-5)。キーは clarity, filler, synthesis, logic, empathy")
    feedback: str = Field(..., description="このトピック内での具体的な会話能力の評価・フィードバック")
    evidence_quotes: List[str] = Field(..., description="評価の根拠となった実際のセリフ・発言の引用")

class FillerItem(BaseModel):
    filler_word: str = Field(..., description="検出されたフィラー（例: 'あの', 'ええと'）")
    context: str = Field(..., description="そのフィラーが使われた前後の文脈セリフ")
    timestamp: str = Field(..., description="発生した時間帯（推定）")

# Geminiの構造化出力用のPydanticスキーマ
class MtgTrainingResultSchema(BaseModel):
    overall_scores: Dict[str, int] = Field(..., description="会話全体に対する各指標のスコア(1-5)。キーは clarity, filler, synthesis, logic, empathy")
    overall_feedback: str = Field(..., description="全体を通した定量的・客観的な評価の総評と、改善アクションプラン")
    topic_evaluations: List[TopicEvaluation] = Field(..., description="トピック（場面セグメント）ごとの詳細評価のリスト")
    detected_fillers: List[FillerItem] = Field(..., description="検出されたフィラーのリスト")

class LiveAlertItem(BaseModel):
    category: str = Field(..., description="アラートの種類: 'filler' (フィラー), 'roundabout' (回りくどい), 'logic' (論理/咀嚼不足), 'clarity' (滑舌)")
    detected_text: str = Field(..., description="指摘対象となった発言の一部または全部の抜粋")
    reason: str = Field(..., description="アラートが発生した理由の説明")
    improvement: str = Field(..., description="具体的な改善案や、より良い言い換え例")

class LiveAnalysisResultSchema(BaseModel):
    transcription: str = Field(..., description="音声から文字起こしした全体テキスト")
    alerts: List[LiveAlertItem] = Field(..., description="検出されたアラートのリスト")

class TrainingReviewTask(BaseModel):
    id: str
    media_filename: str
    gcs_path: str
    overall_scores: Dict[str, int]
    overall_feedback: str
    topic_evaluations: List[TopicEvaluation]
    detected_fillers: List[FillerItem]
    status: int = 0  # 0: TODO, 2: DONE
    created_at: datetime.datetime

# --- Helper Functions ---

def get_or_create_config(db: firestore.Client) -> Dict[str, Any]:
    """Firestoreから設定を取得、存在しない場合はデフォルト値で作成する"""
    doc_ref = db.collection(CONFIG_COLLECTION).document(CONFIG_DOC_ID)
    doc = doc_ref.get()
    if doc.exists:
        data = doc.to_dict()
        if "updated_at" in data and not isinstance(data["updated_at"], datetime.datetime):
            data["updated_at"] = None
        return data
    
    # 作成 (Pydanticシリアライズ時のエラーを回避するため、ローカル時間で即時反映します)
    default_data = {
        "system_instruction": DEFAULT_SYSTEM_INSTRUCTION,
        "rubric_definition": DEFAULT_RUBRIC_DEFINITION,
        "updated_at": datetime.datetime.now()
    }
    doc_ref.set(default_data)
    return default_data

# --- Endpoints ---

@router.get("/config", response_model=TrainingConfigResponse)
def get_training_config(db: firestore.Client = Depends(get_firestore_client)):
    """現在のプロンプト設定およびルーブリック定義を取得します"""
    try:
        config = get_or_create_config(db)
        return TrainingConfigResponse(
            system_instruction=config.get("system_instruction", ""),
            rubric_definition=config.get("rubric_definition", ""),
            updated_at=config.get("updated_at")
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/config", response_model=TrainingConfigResponse)
def update_training_config(req: TrainingConfigUpdateRequest, db: firestore.Client = Depends(get_firestore_client)):
    """プロンプト設定およびルーブリック定義を手動で更新します"""
    try:
        doc_ref = db.collection(CONFIG_COLLECTION).document(CONFIG_DOC_ID)
        now = datetime.datetime.now()
        update_data = {
            "system_instruction": req.system_instruction,
            "rubric_definition": req.rubric_definition,
            "updated_at": now
        }
        doc_ref.set(update_data)
        return TrainingConfigResponse(
            system_instruction=req.system_instruction,
            rubric_definition=req.rubric_definition,
            updated_at=now
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/config/chat", response_model=ConfigChatResponse)
async def chat_to_adjust_config(req: ConfigChatRequest):
    """AIと対話を行い、プロンプトやルーブリックの調整案を生成します（壁打ち機能）"""
    try:
        client = get_genai_client()
        
        system_instruction = """あなたはプロンプトエンジニアリングおよびコンサルタント向け会話指導の専門家です。
ユーザーは、Gemini APIによる「会議会話トレーニング評価」用のプロンプト（System Instruction）と「評価ルーブリック定義」を調整したいと考えています。
現在の設定とユーザーの要求に基づき、適切な修正案を提案してください。

出力は以下のJSONスキーマに従ってください。Markdownブロックは含めず、生のJSONテキストのみを返却してください。

JSON構造：
{
  "assistant_response": "ユーザーへの説明文、修正意図の解説（日本語で丁寧に、です・ます調で）",
  "proposed_system_instruction": "修正されたシステムプロンプトの全文",
  "proposed_rubric_definition": "修正されたルーブリック定義の全文"
}"""

        prompt = f"""【現在のシステムプロンプト】
{req.current_system_instruction}

【現在のルーブリック定義】
{req.current_rubric_definition}

【ユーザーからの要望・指示】
{req.user_message}

上記の要望を反映し、システムプロンプトとルーブリックを適切に更新してください。"""

        response = await client.aio.models.generate_content(
            model=GEMINI_CHAT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
            )
        )

        result = json.loads(response.text)
        return ConfigChatResponse(
            assistant_response=result.get("assistant_response", ""),
            proposed_system_instruction=result.get("proposed_system_instruction", req.current_system_instruction),
            proposed_rubric_definition=result.get("proposed_rubric_definition", req.current_rubric_definition)
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"壁打ち処理に失敗しました: {str(e)}")

@router.post("/review", response_model=TrainingReviewTask)
async def create_training_review(req: TrainingReviewCreateRequest, db: firestore.Client = Depends(get_firestore_client)):
    """アップロードされた会議音声ファイルを、カスタム設定されたプロンプトと評価ルーブリックを用いてGeminiで解析します"""
    try:
        # 1. MIMEタイプの自動判定
        mime_type = "video/mp4" # デフォルト
        path_lower = req.media_filename.lower()
        if path_lower.endswith(".mp3"): mime_type = "audio/mpeg"
        elif path_lower.endswith(".wav"): mime_type = "audio/wav"
        elif path_lower.endswith(".m4a"): mime_type = "audio/mp4"
        elif path_lower.endswith(".aac"): mime_type = "audio/aac"
        elif path_lower.endswith(".amr"): mime_type = "audio/amr"
        elif path_lower.endswith(".mov"): mime_type = "video/quicktime"
        elif path_lower.endswith(".webm"): mime_type = "video/webm"
        elif path_lower.endswith(".3gp"): mime_type = "video/3gpp"
        elif path_lower.endswith(".mkv"): mime_type = "video/x-matroska"
        elif path_lower.endswith(".avi"): mime_type = "video/x-msvideo"

        part = types.Part.from_uri(file_uri=req.gcs_path, mime_type=mime_type)

        # 2. Firestoreから最新のプロンプトとルーブリックを読み込む
        config = get_or_create_config(db)
        system_instruction = config.get("system_instruction")
        rubric_definition = config.get("rubric_definition")

        # 3. 解析用プロンプトの構築
        prompt = f"""添付の音声を解析し、コンサルタントとしての会話能力を評価してください。
客観的かつ定量的な判定を行うため、以下の評価ルーブリックの記述を厳密に解釈して点数と評価を決定してください。

【評価ルーブリック定義】
{rubric_definition}

【指示】
1. 会話全体を通じた「滑舌と明瞭さ(clarity)」「フィラー抑制(filler)」「要約・咀嚼力(synthesis)」「論理的構成力(logic)」「対話態度と配慮(empathy)」をそれぞれ1〜5点（整数値）で採点し、全体の総評を作成してください。
2. 長い会話に対応するため、会議内の主要なトピック（場面セグメント）を検出し、トピックごとに各指標の評価、簡潔な要約、具体的な指摘事項、およびその判断基準となったセリフ（発言）を具体的に引用して出力してください。
3. 会話全体の中から検出されたフィラー（「あの」「ええと」「ちょっと」等の口癖、あるいはもごもごして意味を持たない雑音）の一覧を作成し、その文脈セリフを提示してください。
"""

        # 4. Gemini API の呼び出し（構造化出力: JSON スキーマ）
        client = get_genai_client()
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=[prompt, part],
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=MtgTrainingResultSchema,
                temperature=0.2, # 評価のブレを防ぐために低めの温度を設定
            )
        )

        result_data = json.loads(response.text)

        # 5. Firestoreへ結果を保存
        doc_ref = db.collection(TASKS_COLLECTION).document()
        task_id = doc_ref.id

        task_data = {
            "id": task_id,
            "media_filename": req.media_filename,
            "gcs_path": req.gcs_path,
            "overall_scores": result_data.get("overall_scores", {}),
            "overall_feedback": result_data.get("overall_feedback", "評価が正常に生成されませんでした。"),
            "topic_evaluations": result_data.get("topic_evaluations", []),
            "detected_fillers": result_data.get("detected_fillers", []),
            "status": 0,
            "created_at": firestore.SERVER_TIMESTAMP
        }
        
        doc_ref.set(task_data)

        # レスポンス用に created_at をオブジェクト化
        task_data["created_at"] = datetime.datetime.now()

        return TrainingReviewTask(**task_data)

    except Exception as e:
        import traceback
        print(f"Error in create_training_review: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"トレーニング解析に失敗しました: {str(e)}")

@router.get("", response_model=List[TrainingReviewTask])
def get_training_tasks(db: firestore.Client = Depends(get_firestore_client)):
    """MTGトレーニングの履歴一覧を最新順で取得します"""
    try:
        docs = db.collection(TASKS_COLLECTION).order_by("created_at", direction=firestore.Query.DESCENDING).stream()
        tasks = []
        for d in docs:
            data = d.to_dict()
            tasks.append(TrainingReviewTask(**data))
        return tasks
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/{task_id}/status")
def update_training_task_status(task_id: str, status: int, db: firestore.Client = Depends(get_firestore_client)):
    """タスクのステータス（TODO / DONE）を更新します"""
    try:
        doc_ref = db.collection(TASKS_COLLECTION).document(task_id)
        if not doc_ref.get().exists:
            raise HTTPException(status_code=404, detail="Task not found")
        doc_ref.update({"status": status})
        return {"status": "updated", "new_status": status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{task_id}")
def delete_training_task(task_id: str, db: firestore.Client = Depends(get_firestore_client)):
    """指定されたトレーニング履歴を削除します"""
    try:
        db.collection(TASKS_COLLECTION).document(task_id).delete()
        return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/live-gemini/analyze", response_model=LiveAnalysisResultSchema)
async def analyze_live_audio(file: UploadFile = File(...)):
    """数秒単位で送られてきたマイク音声バッファをGeminiで解析し、発話アラートをリアルタイム返却します"""
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="音声データが空です。")

        # MIMEタイプの判定と調整
        mime_type = file.content_type or "audio/webm"
        if "webm" in mime_type:
            mime_type = "audio/webm"
        elif "ogg" in mime_type:
            mime_type = "audio/ogg"
        elif "wav" in mime_type:
            mime_type = "audio/wav"
        elif "mp3" in mime_type or "mpeg" in mime_type:
            mime_type = "audio/mpeg"
        
        # Partオブジェクトの作成
        part = types.Part.from_bytes(data=content, mime_type=mime_type)

        prompt = """添付された短い音声ファイルを解析し、コンサルタントとしての発話課題をリアルタイム評価してください。
以下の観点で発話課題（アラート）を検出してください：
1. フィラー: 「あの」「ええと」「ちょっと」「まあ」等の無意識の口癖や無駄な雑音。
2. 回りくどい表現: 結論ファーストではなく、冗長であったりダラダラと話している箇所。
3. 要約咀嚼の不足/論理破綻: 話の意味が通っていない、あるいは前後で矛盾している箇所。
4. 滑舌の乱れ: 音声の中で聞き取りにくい箇所、もごもごしている箇所。

【最重要指示: ハルシネーション（幻聴）の防止】
- 音声が無音である場合、またはエアコンの動作音やマイクの電気的ノイズなどの背景雑音（ノイズ）のみで、人の明確な発話が聞き取れない場合は、文字起こし (transcription) を必ず空文字列 "" にしてください。
- また、その場合はアラート (alerts) も必ず空リスト [] にして返却してください。
- 音声に含まれていない架空の対話や、「ええと、プロジェクトの進捗...」などのビジネスライクな発話を絶対に捏造して出力しないでください。

※アラートが一切検出されなかった場合は、alertsリストを空にして返却してください。
"""

        client = get_genai_client()
        
        # 安定性と速度に優れた gemini-2.5-flash を使用
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=[prompt, part],
            config=types.GenerateContentConfig(
                system_instruction="あなたは一流のビジネスコミュニケーションコーチです。発話の欠点を素早く見つけ、建設的に指導します。",
                response_mime_type="application/json",
                response_schema=LiveAnalysisResultSchema,
                temperature=0.1
            )
        )

        result_data = json.loads(response.text)
        return LiveAnalysisResultSchema(**result_data)

    except Exception as e:
        import traceback
        print(f"Error in analyze_live_audio: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"リアルタイム音声解析に失敗しました: {str(e)}")

class SidebarSettingsModel(BaseModel):
    hidden_items: List[str] = Field(default_factory=list, description="非表示に設定されたサイドバー項目のhrefリスト")

@router.get("/sidebar/settings", response_model=SidebarSettingsModel)
def get_sidebar_settings(db: firestore.Client = Depends(get_firestore_client)):
    """サイドバーの非表示設定を取得します"""
    try:
        doc_ref = db.collection(CONFIG_COLLECTION).document("sidebar_visible_config")
        doc = doc_ref.get()
        if doc.exists:
            data = doc.to_dict()
            return SidebarSettingsModel(hidden_items=data.get("hidden_items", []))
        return SidebarSettingsModel(hidden_items=[])
    except Exception as e:
        print(f"Error in get_sidebar_settings: {e}")
        raise HTTPException(status_code=500, detail=f"サイドバー設定の取得に失敗しました: {str(e)}")

@router.post("/sidebar/settings", response_model=SidebarSettingsModel)
def update_sidebar_settings(req: SidebarSettingsModel, db: firestore.Client = Depends(get_firestore_client)):
    """サイドバーの非表示設定を更新・保存します"""
    try:
        doc_ref = db.collection(CONFIG_COLLECTION).document("sidebar_visible_config")
        doc_ref.set({
            "hidden_items": req.hidden_items,
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        return req
    except Exception as e:
        print(f"Error in update_sidebar_settings: {e}")
        raise HTTPException(status_code=500, detail=f"サイドバー設定の保存に失敗しました: {str(e)}")

class TrainingReviewTextCreateRequest(BaseModel):
    media_filename: str
    full_transcript: str

@router.post("/review-text", response_model=TrainingReviewTask)
async def create_training_review_text(req: TrainingReviewTextCreateRequest, db: firestore.Client = Depends(get_firestore_client)):
    """文字起こしテキスト（全体）を元に、Geminiでコンサルタント会話能力の定量評価を行いFirestoreに保存します"""
    try:
        if not req.full_transcript.strip():
            raise HTTPException(status_code=400, detail="文字起こしテキストが空です。")

        # 1. Firestoreから最新のプロンプトとルーブリックを読み込む
        config = get_or_create_config(db)
        system_instruction = config.get("system_instruction")
        rubric_definition = config.get("rubric_definition")

        # 2. 解析用プロンプトの構築
        prompt = f"""以下の会議の文字起こしテキスト（全体）を詳細に解析し、コンサルタントとしての会話能力を評価してください。
客観的かつ定量的な判定を行うため、以下の評価ルーブリックの記述を厳密に解釈して点数と評価を決定してください。

【評価ルーブリック定義】
{rubric_definition}

【会議の文字起こしテキスト（全体）】
{req.full_transcript}

【指示】
1. 会話全体を通じた「滑舌と明瞭さ(clarity)」「フィラー抑制(filler)」「要約・咀嚼力(synthesis)」「論理的構成力(logic)」「対話態度と配慮(empathy)」をそれぞれ1〜5点（整数値）で採点し、全体の総評を作成してください。
2. 会議内の主要なトピック（場面セグメント）を検出し、トピックごとに各指標の評価、簡潔な要約、具体的な指摘事項、およびその判断基準となったセリフ（発言）を具体的に引用して出力してください。（※テキストベースでの解析となるため、時間帯はおおよその時間、あるいはセグメント順序で補正してください）
3. 会話全体の中から検出されたフィラー（「あの」「ええと」「ちょっと」等の口癖、あるいはもごもごして意味を持たない雑音）の一覧を作成し、その文脈セリフを提示してください。
"""

        # 3. Gemini API の呼び出し（構造化出力: JSON スキーマ）
        client = get_genai_client()
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=MtgTrainingResultSchema,
                temperature=0.2,
            )
        )

        result_data = json.loads(response.text)

        # 4. Firestoreへ結果を保存
        doc_ref = db.collection(TASKS_COLLECTION).document()
        task_id = doc_ref.id

        task_data = {
            "id": task_id,
            "media_filename": req.media_filename,
            "gcs_path": "text_based_evaluation",
            "overall_scores": result_data.get("overall_scores", {}),
            "overall_feedback": result_data.get("overall_feedback", "評価が正常に生成されませんでした。"),
            "topic_evaluations": result_data.get("topic_evaluations", []),
            "detected_fillers": result_data.get("detected_fillers", []),
            "status": 0,
            "created_at": firestore.SERVER_TIMESTAMP
        }
        
        doc_ref.set(task_data)

        # レスポンス用に created_at をオブジェクト化
        task_data["created_at"] = datetime.datetime.now()

        return TrainingReviewTask(**task_data)

    except Exception as e:
        import traceback
        print(f"Error in create_training_review_text: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"テキストベースのトレーニング解析に失敗しました: {str(e)}")
