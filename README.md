This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Railway CLI Deployment

The repository includes a multi-stage Dockerfile so Railway can build both the Next.js frontend and the Python helpers in a single container.

### Prerequisites
- Install the [Railway CLI](https://docs.railway.com/cli/quick-start).
- Authenticate: `railway login`.

### One-time project setup
```bash
railway init --new
railway environments create production
railway variables set PICARTA_API_TOKEN=your_token REALITY_DEFENDER_API_KEY=your_key
```

### Deploy from the CLI
```bash
railway up --service foka-tool
```
The CLI detects the `Dockerfile`, builds it remotely, and runs `npm start` (bound to Railway's `$PORT`).

Subsequent deployments from another machine:
```bash
railway login
railway link
railway up
```
