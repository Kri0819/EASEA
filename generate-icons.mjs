// generate-icons.mjs
// Run once: node generate-icons.mjs
// Requires: npm install -D sharp
//
// This script reads public/icon-source.svg and outputs all required icon sizes.
// If you don't have sharp, you can manually export icons from Figma / Canva
// using the sizes listed below.

import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const OUT = 'public/icons'
mkdirSync(OUT, { recursive: true })

// Inline SVG — Easea orb logo (replace with your own SVG if you have one)
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="115" fill="#ECF0FA"/>
  <circle cx="256" cy="256" r="180"
    fill="url(#g1)" opacity=".92"/>
  <circle cx="210" cy="210" r="90"
    fill="url(#g2)" opacity=".65"/>
  <circle cx="290" cy="200" r="50"
    fill="white" opacity=".28"/>
  <circle cx="248" cy="248" r="6" fill="white" opacity=".9"/>
  <circle cx="278" cy="228" r="4" fill="white" opacity=".7"/>
  <circle cx="232" cy="268" r="3" fill="white" opacity=".55"/>
  <defs>
    <radialGradient id="g1" cx="38%" cy="35%" r="65%">
      <stop offset="0%"   stop-color="#C8B8F0"/>
      <stop offset="50%"  stop-color="#9AB8E8"/>
      <stop offset="100%" stop-color="#A8D8EE"/>
    </radialGradient>
    <radialGradient id="g2" cx="40%" cy="38%" r="60%">
      <stop offset="0%"   stop-color="#E0D0F8" stop-opacity=".9"/>
      <stop offset="100%" stop-color="#B8C8F0" stop-opacity=".5"/>
    </radialGradient>
  </defs>
</svg>`

const svgBuf = Buffer.from(SVG)

const SIZES = [16, 32, 48, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512]

async function run() {
  for (const size of SIZES) {
    const out = join(OUT, `icon-${size}.png`)
    await sharp(svgBuf).resize(size, size).png().toFile(out)
    console.log(`✓ ${out}`)
  }

  // maskable — add padding so icon fits safe zone (80% of canvas)
  const maskBuf = await sharp(svgBuf)
    .resize(410, 410)
    .extend({ top:51, bottom:51, left:51, right:51, background:'#ECF0FA' })
    .png()
    .toBuffer()
  await sharp(maskBuf).resize(512,512).png().toFile(join(OUT,'icon-512-maskable.png'))
  console.log('✓ public/icons/icon-512-maskable.png')

  // apple-touch-icon at root (180px, no padding)
  await sharp(svgBuf).resize(180,180).png().toFile('public/apple-touch-icon.png')
  console.log('✓ public/apple-touch-icon.png')

  // favicon.ico (48px)
  await sharp(svgBuf).resize(48,48).png().toFile('public/favicon.ico')
  console.log('✓ public/favicon.ico')

  console.log('\nAll icons generated! ✅')
}

run().catch(console.error)
