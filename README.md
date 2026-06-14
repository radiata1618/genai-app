This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## LLMモデルの管理と変更ルール

本プロジェクトでは、アプリケーション内で使用されるLLM（Geminiなど）のモデルIDを以下の共通ファイルに集約して管理しています。モデルのアップデートや変更の際は、各ファイルを直接編集するのではなく、必ず以下の共通定数ファイルを修正してください。

### 各言語でのモデル設定ファイル
- **バックエンド (Python/FastAPI)**: [backend/config.py](file:///c:/programing/genai-app/backend/config.py)
- **フロントエンド (Next.js/JavaScript)**: [app/constants/models.js](file:///c:/programing/genai-app/app/constants/models.js)

### AIエージェント向けの開発ルール
AntigravityなどのAIエージェント向けには、詳細なルールを [.agent/rules/llm_models.md](file:///c:/programing/genai-app/.agent/rules/llm_models.md) に定義しています。新しくAI機能を追加・改修する際はこのルールが参照されます。
