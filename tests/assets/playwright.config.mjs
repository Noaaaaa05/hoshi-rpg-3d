import { defineConfig,devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({testDir:'.',testMatch:'browser.spec.mjs',workers:1,timeout:30000,reporter:'list',
  use:{baseURL:'http://127.0.0.1:5174',trace:'off'},
  webServer:{command:'python3 -m http.server 5174 --bind 127.0.0.1 --directory work/assets-browser',cwd:fileURLToPath(new URL('../..',import.meta.url)),url:'http://127.0.0.1:5174',reuseExistingServer:!process.env.CI},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],launchOptions:{...(process.env.HOSHI_CHROMIUM_PATH?{executablePath:process.env.HOSHI_CHROMIUM_PATH}:{})}}},{name:'webkit',use:{...devices['iPhone 13'],browserName:'webkit'}}]});
