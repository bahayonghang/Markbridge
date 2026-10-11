import { writeFileSync } from 'node:fs'

const port = Number(process.argv[2] ?? 9333)
const action = process.argv[3] ?? 'read'

const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
if (!page) {
  console.log(`PAGES=${pages.length}`)
  for (const item of pages) console.log(`${item.type} ${item.url} ${item.title}`)
  process.exit(2)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
})

function send(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve) => pending.set(id, resolve))
}

if (action === 'shot') {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const data = shot.result?.data
  if (!data) {
    console.log(JSON.stringify(shot))
    process.exit(2)
  }
  writeFileSync(process.argv[4], Buffer.from(data, 'base64'))
  console.log(`SHOT=${process.argv[4]} BYTES=${Buffer.from(data, 'base64').length}`)
  socket.close()
  process.exit(0)
}

const expression = action === 'probe'
  ? `(() => {
      const status = document.querySelector('[role="status"]')
      const style = getComputedStyle(status)
      const rect = status.getBoundingClientRect()
      const top = document.elementFromPoint(rect.left + 4, rect.top + 4)
      return {
        text: status.textContent,
        color: style.color,
        fill: style.webkitTextFillColor,
        opacity: style.opacity,
        bg: style.backgroundColor,
        overflow: getComputedStyle(status.parentElement).overflow,
        topTag: top && top.outerHTML.slice(0, 180),
        html: status.outerHTML,
      }
    })()`
  : action === 'top'
  ? `(() => {
      const status = document.querySelector('[role="status"]')
      status?.scrollIntoView({ block: 'start' })
      window.scrollTo(0, 0)
      return { status: status ? status.textContent : null, rect: status ? status.getBoundingClientRect().toJSON() : null, innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio }
    })()`
  : action === 'scroll'
  ? `(() => {
      const node = [...document.querySelectorAll('p')].find((item) => item.textContent.includes('尚未连接书签来源'))
      if (!node) return { ok: false }
      node.scrollIntoView({ block: 'center' })
      const status = document.querySelector('[role="status"]')
      return {
        ok: true,
        status: status ? status.textContent : null,
        target: node.textContent,
        rect: node.getBoundingClientRect().toJSON(),
        statusRect: status ? status.getBoundingClientRect().toJSON() : null,
      }
    })()`
  : `(() => {
      const status = document.querySelector('[role="status"]')
      const style = status ? getComputedStyle(status) : null
      return {
        status: status ? status.textContent : null,
        color: style && style.color,
        display: style && style.display,
        visibility: style && style.visibility,
        fontSize: style && style.fontSize,
        rect: status ? status.getBoundingClientRect().toJSON() : null,
        text: document.body.innerText,
        buttons: [...document.querySelectorAll('button')].map((button) => ({ name: button.textContent, disabled: button.disabled })),
        articles: document.querySelectorAll('article').length,
        pairing: document.querySelector('#pairing-code') ? document.querySelector('#pairing-code').value.length : 0,
      }
    })()`

const result = await send('Runtime.evaluate', { expression, returnByValue: true })
console.log(JSON.stringify(result.result?.result?.value ?? result, null, 2))
socket.close()
