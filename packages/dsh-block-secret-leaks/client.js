// Settings page for DSH's sidebar Plugins page (the browser half of this plugin).
// Plain JavaScript in DSH's client module format, so it ships without a bundler.
// The top part describes this plugin's fields; the bottom part is the same in
// every dsh-* plugin.
window.__ModuleLoader__.load({
  id: 'dsh-block-secret-leaks',
  factory: (require) => {
    const module = { exports: {} }
    const { jsx, jsxs } = require('react/jsx-runtime')
    const P = require('@deepseek-ai/dsh-client-ui-primitives')

    // ---- This plugin ------------------------------------------------------

    const PACKAGE = 'dsh-block-secret-leaks'
    const ENTRY = 'block-secret-leaks'

    const RULES = ['read-secret-file','copy-secret-file','upload-secret-file','dump-env','echo-secret-var','git-add-secret','literal-secret']

    const FIELDS = [
      { kind: 'choice', field: 'mode', options: ['deny','ask'], fallback: 'deny' },
      { kind: 'switch', field: 'guardReads', fallback: true },
      { kind: 'switch', field: 'guardShell', fallback: true },
      { kind: 'flags', field: 'disabledRules', options: RULES, inverted: true },
      { kind: 'switch', field: 'guardWrites', fallback: true },
      { kind: 'switch', field: 'redactOutput', fallback: true },
      { kind: 'switch', field: 'allowIdenticalRetry', fallback: false },
      { kind: 'lines', field: 'secretFiles' },
      { kind: 'lines', field: 'extraPatterns' },
      { kind: 'words', field: 'extraSecretNames' },
      { kind: 'words', field: 'shellTools' },
      { kind: 'words', field: 'readTools' },
    ]

    const COPY = {
      en: {
        summary: 'Keeps secrets out of the conversation and out of git.',
        mode_label: 'When something would expose a secret',
        mode_hint: 'Block tells the model why and what to do instead. Ask shows you an approval prompt.',
        mode_deny: 'Block it',
        mode_ask: 'Ask me',
        guardReads_label: 'Block reading secret files',
        guardReads_hint: 'The read tool on .env, private keys, .npmrc and the other files listed below.',
        guardShell_label: 'Check shell commands',
        disabledRules_label: 'What counts as exposing a secret in the shell',
        disabledRules_hint: 'Untick anything you want to allow.',
        'disabledRules_read-secret-file': 'Printing a secret file (cat .env, Get-Content .env)',
        'disabledRules_copy-secret-file': 'Copying a secret file somewhere that is not secret (cp .env .env.example)',
        'disabledRules_upload-secret-file': 'Uploading or sending a secret file (curl -F file=@.env, scp)',
        'disabledRules_dump-env': 'Printing every environment variable (env, printenv, gci env:)',
        'disabledRules_echo-secret-var': 'Printing a secret variable (echo $API_KEY)',
        'disabledRules_git-add-secret': 'Staging a secret file for commit',
        'disabledRules_literal-secret': 'A secret value written out in the command',
        guardWrites_label: 'Block writing secrets into committed files',
        guardWrites_hint: 'Secrets may still go into git-ignored files like .env.',
        redactOutput_label: 'Redact secrets from tool output',
        redactOutput_hint: 'Replaces them with [REDACTED: NAME] before the model sees the output.',
        allowIdenticalRetry_label: 'Let the model confirm by repeating the call',
        allowIdenticalRetry_hint: 'Off by default: a secret, once sent, cannot be taken back.',
        secretFiles_label: 'Which files hold secrets',
        secretFiles_hint: 'One glob per line, relative to the workspace. Start a line with ! to exclude.',
        extraPatterns_label: 'Extra secret formats',
        extraPatterns_hint: 'One regular expression per line, for tokens only your company uses.',
        extraSecretNames_label: 'Extra secret variable names',
        extraSecretNames_hint: 'Names that hold secrets but do not look like it, separated by commas.',
        shellTools_label: 'Shell tools to watch',
        shellTools_hint: 'Tool names, separated by commas. On Windows the shell tool is pwsh.',
        readTools_label: 'Read tools to watch',
        readTools_hint: 'Tool names, separated by commas.',
      },
      zh: {
        summary: '不让密钥进入对话，也不让它进入 git。',
        mode_label: '操作会泄露密钥时',
        mode_hint: '阻止：告诉模型原因和替代做法。询问：弹出审批让你决定。',
        mode_deny: '阻止',
        mode_ask: '询问我',
        guardReads_label: '阻止读取密钥文件',
        guardReads_hint: '用 read 工具读取 .env、私钥、.npmrc 以及下面列出的其他文件。',
        guardShell_label: '检查 shell 命令',
        disabledRules_label: '哪些 shell 操作算泄露密钥',
        disabledRules_hint: '取消勾选你想放行的项。',
        'disabledRules_read-secret-file': '打印密钥文件（cat .env、Get-Content .env）',
        'disabledRules_copy-secret-file': '把密钥文件复制到非密钥文件（cp .env .env.example）',
        'disabledRules_upload-secret-file': '上传或发送密钥文件（curl -F file=@.env、scp）',
        'disabledRules_dump-env': '打印全部环境变量（env、printenv、gci env:）',
        'disabledRules_echo-secret-var': '打印密钥变量（echo $API_KEY）',
        'disabledRules_git-add-secret': '把密钥文件加入暂存区准备提交',
        'disabledRules_literal-secret': '命令里直接写出了密钥的值',
        guardWrites_label: '阻止把密钥写进会被提交的文件',
        guardWrites_hint: '密钥仍然可以写进被 git 忽略的文件，例如 .env。',
        redactOutput_label: '从工具输出中隐去密钥',
        redactOutput_hint: '在模型看到输出之前替换成 [REDACTED: 名称]。',
        allowIdenticalRetry_label: '允许模型原样重试一次来确认',
        allowIdenticalRetry_hint: '默认关闭：密钥一旦发出就收不回来。',
        secretFiles_label: '哪些文件存放密钥',
        secretFiles_hint: '每行一个 glob，相对于工作区。以 ! 开头表示排除。',
        extraPatterns_label: '额外的密钥格式',
        extraPatterns_hint: '每行一个正则表达式，用于只有你们公司在用的令牌。',
        extraSecretNames_label: '额外的密钥变量名',
        extraSecretNames_hint: '存放密钥但名字看不出来的变量，用逗号分隔。',
        shellTools_label: '要检查的 shell 工具',
        shellTools_hint: '工具名，用逗号分隔。Windows 上 shell 工具是 pwsh。',
        readTools_label: '要检查的读取工具',
        readTools_hint: '工具名，用逗号分隔。',
      },
    }

    // ---- Shared page (identical in every dsh-* plugin) ---------------------

    const FORM_COPY = {
      en: { unavailable: 'This plugin is not loaded, so it cannot be configured right now.', readOnly: 'This deployment stores settings read-only.', saveFailed: 'DSH did not accept these values; they were left for you to correct.', save: 'Save', saving: 'Saving…', overridden: 'Changed', reset: 'Reset to default', invalid: 'Enter a number, or leave blank for the default.' },
      zh: { unavailable: '该插件当前未加载，暂时无法配置。', readOnly: '本部署的设置为只读。', saveFailed: 'DSH 没有接受这些值，已保留供你修改。', save: '保存', saving: '保存中…', overridden: '已修改', reset: '恢复默认', invalid: '请填数字；留空表示使用默认值。' },
    }
    const NS = `plugin.${PACKAGE}`

    /** Text <-> config value conversions for each kind of control. */
    const SPECS = {
      choice: (f) => ({ field: f.field, format: (v) => (typeof v === 'string' ? v : f.fallback), parse: (t) => (f.options.includes(t) ? { kind: 'set', value: t } : undefined) }),
      switch: (f) => ({ field: f.field, format: (v) => String(typeof v === 'boolean' ? v : f.fallback), parse: (t) => (t === 'true' || t === 'false' ? { kind: 'set', value: t === 'true' } : undefined) }),
      number: (f) => P.settingsNumberField(f.field),
      lines: (f) => ({ field: f.field, format: (v) => (Array.isArray(v) ? v.join('\n') : ''), parse: (t) => ({ kind: 'set', value: t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) }) }),
      words: (f) => ({ field: f.field, format: (v) => (Array.isArray(v) ? v.join(', ') : ''), parse: (t) => ({ kind: 'set', value: t.split(/[\s,]+/).filter(Boolean) }) }),
      flags: (f) => ({ field: f.field, format: (v) => (Array.isArray(v) ? [...v].sort().join(',') : ''), parse: (t) => ({ kind: 'set', value: t ? t.split(',') : [] }) }),
      pairs: (f) => ({
        field: f.field,
        format: (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([k, val]) => `${k} = ${val}`).join('\n') : ''),
        parse: (t) => ({ kind: 'set', value: Object.fromEntries(t.split(/\r?\n/).map((line) => { const i = line.indexOf('='); return i < 0 ? [line.trim(), ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()] }).filter(([k]) => k)) }),
      }),
    }

    // Same look as DSH's own settings fields (primitives' fields.module.css).
    const S = {
      field: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' },
      divider: { borderTop: '0.5px solid var(--dsw-alias-border-l2)' },
      head: { display: 'flex', alignItems: 'center', gap: 8 },
      label: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' },
      hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
      reset: { border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
      badges: { display: 'inline-flex', alignItems: 'center', gap: 8 },
      textarea: { minHeight: 96, padding: '8px 12px', border: '0.5px solid var(--dsw-alias-border-l4)', borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-layer-3)', font: 'inherit', fontFamily: 'var(--dsw-font-mono, ui-monospace, monospace)', fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-primary)', resize: 'vertical' },
      flags: { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 },
    }

    function Head({ id, label, state, form, t }) {
      return jsxs('div', {
        style: S.head,
        children: [
          jsx('label', { style: S.label, htmlFor: id, children: label }),
          state.overridden ? jsxs('span', { style: S.badges, children: [jsx(P.Tag, { tone: 'neutral', children: t('overridden') }), jsx('button', { type: 'button', style: S.reset, disabled: form.disabled, onClick: () => form.resetField(form.fieldName), children: t('reset') })] }) : null,
        ],
      })
    }

    function Field({ f, state, props, disabled, first, t, ft }) {
      const id = `${PACKAGE}-${f.field}`
      const label = t(`${f.field}_label`)
      const hintKey = `${f.field}_hint`
      const hintText = t(hintKey)
      const hint = typeof hintText === 'string' && hintText !== hintKey ? hintText : ''
      const edit = (text) => props.edit(f.field, text)
      const wrap = (control) => jsxs('div', {
        style: first ? S.field : { ...S.field, ...S.divider },
        children: [jsx(Head, { id, label, state, t: ft, form: { disabled, resetField: props.resetField, fieldName: f.field } }), control, hint ? jsx('p', { style: S.hint, children: hint }) : null],
      })
      switch (f.kind) {
        case 'number':
        case 'words':
          return jsx('div', {
            style: first ? undefined : S.divider,
            children: jsx(P.SettingsValueField, { id, label, hint, overriddenLabel: ft('overridden'), resetLabel: ft('reset'), invalidLabel: ft('invalid'), numeric: f.kind === 'number', disabled, ...state, onEdit: edit, onReset: () => props.resetField(f.field) }),
          })
        case 'choice':
          return wrap(jsx('div', { children: jsx(P.SegmentedControl, { id, label, value: state.text, disabled, options: f.options.map((o) => ({ value: o, label: t(`${f.field}_${o}`) })), onChange: edit }) }))
        case 'switch':
          return wrap(jsx('div', { children: jsx(P.Switch, { label, checked: state.text === 'true', disabled, onChange: (next) => edit(String(next)) }) }))
        case 'lines':
        case 'pairs':
          return wrap(jsx('textarea', { id, style: S.textarea, spellCheck: false, value: state.text, disabled, onChange: (e) => edit(e.target.value) }))
        case 'flags': {
          const set = new Set(state.text ? state.text.split(',') : [])
          return wrap(jsx('div', {
            style: S.flags,
            children: f.options.map((o) => jsx(P.Checkbox, {
              label: t(`${f.field}_${o}`),
              checked: f.inverted ? !set.has(o) : set.has(o),
              disabled,
              onChange: (checked) => {
                const on = f.inverted ? !checked : checked
                if (on) set.add(o)
                else set.delete(o)
                edit([...set].sort().join(','))
              },
            }, o)),
          }))
        }
        default:
          return null
      }
    }

    function Page(props) {
      const { t } = props
      const ft = (key) => t(`form_${key}`)
      const state = props.usePage((snapshot) => snapshot)
      if (props.view === 'summary') return t('summary')
      const disabled = !state.writable
      return jsx(P.SettingsForm, {
        labels: { unavailable: ft('unavailable'), readOnly: ft('readOnly'), saveFailed: ft('saveFailed'), save: ft('save'), saving: ft('saving') },
        state,
        onSave: props.save,
        onDiscard: props.discard,
        children: FIELDS.map((f, i) => jsx(Field, { f, state: state.fields[f.field], props, disabled, first: i === 0, t, ft }, f.field)),
      })
    }

    const inject = ['slots', 'locale', 'configForms']

    function apply(ctx) {
      const dictionary = (lang) => ({ ...COPY[lang], ...Object.fromEntries(Object.entries(FORM_COPY[lang]).map(([k, v]) => [`form_${k}`, v])) })
      ctx.effect(() => ctx.locale.register(NS, { en: dictionary('en'), zh: dictionary('zh') }), `${PACKAGE}: dictionaries`)
      const form = new P.SettingsFormModel(ctx.configForms.get(ENTRY), FIELDS.map((f) => SPECS[f.kind](f)))
      const store = form.bind(() => ({ ...form.shell(), fields: Object.fromEntries(FIELDS.map((f) => [f.field, form.field(f.field)])) }))
      ctx.effect(() => () => form.dispose(), `${PACKAGE}: form`)
      ctx.effect(() => ctx.configForms.whileServed([ENTRY], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PACKAGE,
        locale: NS,
        inject: () => ({ hooks: { page: store }, ...form.actions() }),
      }, Page))), `${PACKAGE}: settings page`)
    }

    module.exports.inject = inject
    module.exports.apply = apply
    return module.exports
  },
})
