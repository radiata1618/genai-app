# LLMモデル管理・更新の開発標準ルール (AI Agent Rules)

本プロジェクトでは、アプリケーションの各所で使用されるLLM（Geminiなど）のモデル名・IDを一元管理しています。
開発やリファクタリング時にモデルIDの参照や更新を行う際は、以下のルールを厳格に遵守してください。

---

## 1. 原則: モデルIDのハードコード禁止
ソースコード内のいかなる場所においても、モデルID（例: `"gemini-3-flash-preview"` など）の文字列リテラルを直接ハードコードしてAPIを呼び出すことは禁止します。
必ず以下で定義された共通のConfigファイルからインポートして使用してください。

---

## 2. 定義ファイルの場所

### バックエンド (FastAPI/Python)
- **ファイルパス**: [backend/config.py](file:///c:/programing/genai-app/backend/config.py)
- **使用方法**:
  ```python
  from config import GEMINI_CHAT_MODEL
  
  # API呼び出し
  response = client.models.generate_content(
      model=GEMINI_CHAT_MODEL,
      contents=...
  )
  ```

### フロントエンド (Next.js/JavaScript)
- **ファイルパス**: [app/constants/models.js](file:///c:/programing/genai-app/app/constants/models.js)
- **使用方法**:
  ```javascript
  import { GEMINI_CHAT_MODEL } from '@/app/constants/models';
  
  // API呼び出しやUI側での使用
  const model = GEMINI_CHAT_MODEL;
  ```

---

## 3. モデルをアップデート（切り替え）する手順
モデルのバージョンアップ（例: Gemini 3.0 から Gemini 3.5 への切り替えなど）を行う場合は、以下のファイル内の定数定義のみを修正してください。

1. **バックエンドの変更**: [backend/config.py](file:///c:/programing/genai-app/backend/config.py) 内の該当する定数を書き換えます。
2. **フロントエンドの変更**: [app/constants/models.js](file:///c:/programing/genai-app/app/constants/models.js) 内の該当する定数を書き換えます。

個別のルーターファイルやAPI Routeのファイルを直接編集してモデルIDを変更してはなりません。
