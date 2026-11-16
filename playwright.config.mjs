import { defineConfig, devices } from '@playwright/test';
// A session that cannot download browsers points this at its preinstalled Chromium
// (HOSHI_CHROMIUM_PATH) and runs `npm run test:browser:chromium`. WebKit then runs on GitHub Actions.
const executablePath=process.env.HOSHI_CHROMIUM_PATH;
const chromium={args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],...(executablePath?{executablePath}:{})};
export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,retries:0,timeout:90000,
  reporter:[['list'],['html',{open:'never'}]],
  // Preserve DOM/network traces and explicit screenshots without continuously
  // recording Retina frames on the CI runner's software-rendered WebKit GPU.
  use:{baseURL:'http://127.0.0.1:5173',trace:{mode:'retain-on-failure',screenshots:false,snapshots:true},screenshot:'only-on-failure'},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},
  projects:[
    {name:'chromium-desktop',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:720},deviceScaleFactor:1,launchOptions:chromium}},
    {name:'webkit-iphone-landscape',use:{...devices['iPhone 13'],viewport:{width:844,height:390},screen:{width:844,height:390},browserName:'webkit'}},
    {name:'chromium-touch',use:{...devices['iPhone 13'],viewport:{width:844,height:390},screen:{width:844,height:390},deviceScaleFactor:1,browserName:'chromium',launchOptions:chromium}}
  ]
});
