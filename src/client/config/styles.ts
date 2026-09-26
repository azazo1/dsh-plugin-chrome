/**
 * 配置卡片样式 (与面板样式一样作为字符串内联注入).
 *
 * 只走 ui-theme 的 --dsw-alias-* 语义 token, 不写字面色值; 字段行的节奏
 * 复刻官方设置页: 标签 13px/500, 说明 12px tertiary, 行内 padding 12px 0,
 * 行间 0.5px hairline.
 */
export const CHROME_CONFIG_CSS = `
.dsh-chrome-config__group {
  padding: 16px 0;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-chrome-config__group:last-of-type {
  border-bottom: none;
}
.dsh-chrome-config__label {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-chrome-config__hint {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-chrome-config__rows {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.dsh-chrome-config__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}
.dsh-chrome-config__row > span:first-child {
  flex: 1 1 auto;
  min-width: 0;
}
.dsh-chrome-config__row input {
  width: 100%;
}
.dsh-chrome-config__invalid {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-chrome-config__note {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
`
