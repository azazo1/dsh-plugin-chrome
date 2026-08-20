import { writeFileSync } from 'fs'
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:51937', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
await page.bringToFront().catch(() => {})

// 1. bing (main browsing shot)
await page.goto('https://www.bing.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise((r) => setTimeout(r, 2500))
let shot = await page.screenshot({ type: 'jpeg', quality: 82 })
writeFileSync('assets/screenshot-1-bing.jpg', shot)
console.log('shot1-bing', shot.length)

// 2. douyin (rich content shot)
const p2 = await browser.newPage()
await p2.goto('https://www.douyin.com/jingxuan', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
await new Promise((r) => setTimeout(r, 3500))
shot = await p2.screenshot({ type: 'jpeg', quality: 82 })
writeFileSync('assets/screenshot-2-douyin.jpg', shot)
console.log('shot2-douyin', shot.length)

// 3. welcome page (DSH Chrome brand shot)
await page.bringToFront().catch(() => {})
await page.goto('data:text/html,<title>DSH Chrome</title><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1e1e2e;color:#cdd6f4"><div style="text-align:center"><h1>🌐 DSH Chrome</h1><p>会话专属浏览器窗口</p><p style="opacity:.6">Agent 的操作会实时显示在这里</p></div></body>', { waitUntil: 'domcontentloaded', timeout: 15000 })
await new Promise((r) => setTimeout(r, 1200))
shot = await page.screenshot({ type: 'jpeg', quality: 82 })
writeFileSync('assets/screenshot-3-welcome.jpg', shot)
console.log('shot3-welcome', shot.length)

await browser.disconnect()
process.exit(0)
