/**
 * Tool-surface regression: the mandatory model-authored reason of `chrome_open`
 * and the per-call descriptions that make opaque arguments readable.
 *
 * These checks read the REGISTERED definitions, so they cover what the model is
 * actually offered (schema) and what the Web GUI actually renders (presenters)
 * without starting Chrome.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from '../src/host/config.ts'
import { LaunchConsent } from '../src/host/consent.ts'
import { registerTools, type ToolDeps } from '../src/host/tools.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Register the suite on a stub context and index the definitions by name. */
function suite(): Map<string, ToolDefinition> {
  const registered = new Map<string, ToolDefinition>()
  const ctx = {
    on: (): (() => void) => () => {},
    tools: {
      register: (tool: ToolDefinition): (() => void) => {
        registered.set(tool.name, tool)
        return () => {}
      },
    },
  } as unknown as Context
  const deps = {
    manager: {},
    config: resolveConfig({}),
    consent: new LaunchConsent(),
  } as unknown as ToolDeps
  registerTools(ctx, deps)
  return registered
}

/** Declared names of one tool's required parameters. */
function requiredNames(tool: ToolDefinition): string[] {
  return (tool.parameters as { required?: string[] }).required ?? []
}

/** Provider-neutral card title a pending call renders with. */
function titleOf(tool: ToolDefinition, args: unknown): string | undefined {
  const view = tool.presentCall?.(args)
  return view !== undefined && view.card === 'generic' ? view.title : undefined
}

/** Tools whose arguments do not explain themselves in a card. */
const OPAQUE_ARG_TOOLS = ['chrome_evaluate', 'chrome_click_at', 'chrome_type'] as const

describe('chrome 工具的参数契约', () => {
  it('chrome_open 的 justification 是必填参数', () => {
    const open = suite().get('chrome_open')
    expect(open).toBeDefined()
    expect(requiredNames(open as ToolDefinition)).toContain('justification')
  })

  it('参数不直观的工具要求逐调用 description', () => {
    const tools = suite()
    for (const name of OPAQUE_ARG_TOOLS) {
      const tool = tools.get(name)
      expect(tool, name).toBeDefined()
      expect(requiredNames(tool as ToolDefinition), name).toContain('description')
    }
  })

  it('整套工具都声明了卡片标题', () => {
    const tools = suite()
    expect(tools.size).toBe(16)
    for (const [name, tool] of tools) {
      expect(tool.presentCall, name).toBeTypeOf('function')
    }
  })
})

describe('工具卡片用模型给的文字做标题', () => {
  it('chrome_open 的卡片保留 justification 与 url', () => {
    const open = suite().get('chrome_open') as ToolDefinition
    const view = open.presentCall?.({ justification: '核对订单状态', url: 'example.com' })
    expect(JSON.stringify(view)).toContain('核对订单状态')
    expect(JSON.stringify(view)).toContain('example.com')
  })

  it('描述参数成为卡片标题', () => {
    const tools = suite()
    const evaluate = tools.get('chrome_evaluate') as ToolDefinition
    expect(titleOf(evaluate, { expression: 'return 1', description: '读取商品列表' })).toContain('读取商品列表')
    const click = tools.get('chrome_click_at') as ToolDefinition
    expect(titleOf(click, { x: 10, y: 20, description: '点击登录按钮' })).toContain('点击登录按钮')
    const type = tools.get('chrome_type') as ToolDefinition
    expect(titleOf(type, { text: 'abc', description: '输入搜索词' })).toContain('输入搜索词')
  })

  it('无参数工具也有可读标题', () => {
    const tools = suite()
    expect(titleOf(tools.get('chrome_status') as ToolDefinition, {})).not.toBe('')
    expect(titleOf(tools.get('chrome_close') as ToolDefinition, {})).not.toBe('')
  })
})

/** 一次成功截图的完整返回值; 图片超预算被缩小时 attachment 会多带原图尺寸. */
function shotValue(originalDimensions?: { width: number; height: number }): JsonValue {
  return {
    path: '/tmp/shot.png',
    name: 'shot.png',
    width: 1280,
    height: 800,
    bytes: 4096,
    mediaType: 'image/png',
    pageTitle: 'Example',
    url: 'https://example.com/',
    attachment: {
      attachmentId: 'sha256:0',
      mediaType: 'image/png',
      bytes: 2048,
      width: 1280,
      height: 800,
      name: 'shot.png',
      ...originalDimensions === undefined ? {} : { originalDimensions },
    },
  }
}

describe('chrome_screenshot 的输出契约', () => {
  it('attachment 是开放对象, 上游附加字段不会让截图失败', () => {
    const shot = suite().get('chrome_screenshot') as ToolDefinition
    // 这里走的就是 registry 对每个成功返回值施加的同一条校验.
    expect(validateJsonSchemaValue(shot.output.schema, shotValue({ width: 1280, height: 9000 }), 'value')).toEqual([])
    // 上游日后新增字段 (此处模拟) 同样应当通过.
    const extended = shotValue() as Record<string, JsonValue>
    extended.attachment = { ...extended.attachment as Record<string, JsonValue>, futureField: 'x' }
    expect(validateJsonSchemaValue(shot.output.schema, extended, 'value')).toEqual([])
  })

  it('图片被缩小时文案给出原图尺寸', () => {
    const shot = suite().get('chrome_screenshot') as ToolDefinition
    expect(JSON.stringify(shot.output.render({}, shotValue({ width: 1280, height: 9000 })))).toContain('1280x9000')
    expect(JSON.stringify(shot.output.render({}, shotValue()))).not.toContain('9000')
  })

  it('没有 attachment 服务的部署必须整键省略 attachment', () => {
    const shot = suite().get('chrome_screenshot') as ToolDefinition
    // 值为 undefined 的属性既不是合法值, 也过不了 lossless JSON 检查,
    // 所以工具在无附件服务时不能返回 { attachment: undefined }.
    const absent = shotValue() as Record<string, JsonValue>
    delete absent.attachment
    expect(validateJsonSchemaValue(shot.output.schema, absent, 'value')).toEqual([])
    expect(JSON.stringify(shot.output.render({}, absent))).toContain('/tmp/shot.png')
  })
})
