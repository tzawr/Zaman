// Renders public/logo-full.svg to public/email-logo.png (email clients do not
// show SVG). Run after changing the logo: node scripts/render-email-logo.mjs
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

// The site logo's wordmark is white (dark site); emails are light.
const svg = readFileSync('public/logo-full.svg', 'utf8').replace('fill="#ffffff"', 'fill="#0f172a"')
const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 2 })
await page.setContent(`<html><body style="margin:0;background:transparent"><div id="l" style="display:inline-block;height:32px">${svg.replace('<svg', '<svg style="height:32px;width:auto;display:block"')}</div></body></html>`)
const el = await page.$('#l')
await el.screenshot({ path: 'public/email-logo.png', omitBackground: true })
const box = await el.boundingBox()
console.log(`public/email-logo.png: ${Math.round(box.width)}x${Math.round(box.height)} CSS px at 2x`)
await browser.close()
