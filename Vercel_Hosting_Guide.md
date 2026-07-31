# Vercel Hosting Guide

This document outlines the complete steps to host a React/Vite application on Vercel.

## 1. Prerequisites
- A GitHub, GitLab, or Bitbucket account.
- A Vercel account (sign up at vercel.com).
- Your project pushed to a Git repository.

## 2. Project Preparation
Before deploying, make sure your project is configured correctly for a Single Page Application (SPA).

1. **Build Script:** Ensure your `package.json` has the correct build script. For Vite, it's usually `"build": "vite build"`.
2. **Output Directory:** The standard build output directory for Vite is `dist`.
3. **Routing Configuration:** To handle client-side routing properly on Vercel, create a `vercel.json` file in the root of your project with the following content:
   ```json
   {
     "rewrites": [
       { "source": "/(.*)", "destination": "/index.html" }
     ]
   }
   ```

## 3. Deployment Methods

### Method A: Deploy via Vercel Dashboard (Recommended)
This method connects your Git repository directly to Vercel, enabling automatic deployments whenever you push changes.

1. Go to the [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New...** and select **Project**.
3. **Import Git Repository:** Connect your Git provider and select the repository you want to deploy.
4. **Configure Project:**
   - **Framework Preset:** Vercel usually auto-detects this (e.g., Vite, React).
   - **Root Directory:** If your frontend is inside a specific folder (e.g., `frontend`), select it here.
   - **Build and Output Settings:** Leave default if auto-detected (Build Command: `npm run build`, Output Directory: `dist`).
   - **Environment Variables:** Add any necessary `.env` variables required by your app.
5. Click **Deploy**. Vercel will build and deploy your application.

### Method B: Deploy via Vercel CLI
If you prefer the command line, you can deploy without pushing to Git.

1. Install the Vercel CLI globally:
   ```bash
   npm install -g vercel
   ```
2. Navigate to your project directory in the terminal.
3. Run the deployment command:
   ```bash
   vercel
   ```
4. Follow the prompts to link the project to your Vercel account. This creates a preview deployment.
5. To deploy to production, run:
   ```bash
   vercel --prod
   ```

## 4. Post-Deployment
- **Custom Domains:** In the Vercel dashboard, go to your project's **Settings > Domains** to add a custom domain.
- **Environment Variables Update:** If you need to change environment variables later, update them in **Settings > Environment Variables**, then trigger a new deployment.
