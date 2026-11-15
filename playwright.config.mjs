import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,retries:0,timeout:30000,
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://127.0.0.1:5173',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},
  projects:[
    {name:'chromium-desktop',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:720},launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}}},
    {name:'webkit-iphone-landscape',use:{...devices['iPhone 13'],viewport:{width:844,height:390},screen:{width:844,height:390},browserName:'webkit'}},
    {name:'chromium-touch',use:{...devices['iPhone 13'],defaultBrowserType:undefined,viewport:{width:844,height:390},screen:{width:844,height:390},browserName:'chromium',launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}}}
  ]
});
