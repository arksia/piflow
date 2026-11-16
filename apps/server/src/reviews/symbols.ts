import type { ReviewFileStatistics, ReviewHunk, ReviewSymbolChange, ReviewTarget } from '@piflow/protocol'
import { reviewFileCategory } from '@piflow/protocol'
import ts from 'typescript'

export interface SymbolRange {
  name: string
  key: string
  kind: ReviewSymbolChange['kind']
  stable: boolean
  start: number
  end: number
  text: string
}
export interface SymbolIndex {
  symbols: SymbolRange[]
  testNotes: string[]
}
const testPackages = new Set(['node:test', 'vitest', '@jest/globals', '@playwright/test', 'bun:test'])
const testNames = new Set(['test', 'it'])
const suiteNames = new Set(['describe', 'suite'])
const modifiers = new Set(['only', 'skip', 'todo', 'each', 'concurrent', 'sequential', 'fails', 'serial', 'parallel', 'failing'])
function literal(node: ts.Node | undefined) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined
}
function executable(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) && !!node.body
}
/** One bounded AST parse supplies both review ranges and static change statistics. */
export function indexSymbols(path: string, text: string, deadline: number): SymbolIndex {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
  if (diagnostics.length)
    throw new Error('源码语法无法完整解析')
  const symbols: SymbolRange[] = []
  const notes = new Set<string>()
  const testCallbacks = new WeakMap<ts.Node, { name: string, stable: boolean }>()
  const roots = new Map<string, 'test' | 'suite' | 'namespace'>()
  const importedVariables = new Set<ts.VariableDeclaration>()
  const testFile = reviewFileCategory(path) === 'test'
  if (testFile) {
    for (const name of testNames) roots.set(name, 'test')
    for (const name of suiteNames) roots.set(name, 'suite')
  }
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== 'require' || !testPackages.has(literal(init.arguments[0]) ?? ''))
          continue
        importedVariables.add(declaration)
        if (ts.isIdentifier(declaration.name))
          roots.set(declaration.name.text, literal(init.arguments[0]) === 'node:test' ? 'test' : 'namespace')
        if (ts.isObjectBindingPattern(declaration.name)) {
          for (const binding of declaration.name.elements) {
            const imported = (binding.propertyName ?? binding.name).getText(source)
            if (ts.isIdentifier(binding.name) && (testNames.has(imported) || suiteNames.has(imported)))
              roots.set(binding.name.text, testNames.has(imported) ? 'test' : 'suite')
          }
        }
      }
    }
    if (!ts.isImportDeclaration(statement) || !testPackages.has(literal(statement.moduleSpecifier) ?? ''))
      continue
    const clause = statement.importClause
    if (clause?.isTypeOnly)
      continue
    if (clause?.name && literal(statement.moduleSpecifier) === 'node:test')
      roots.set(clause.name.text, 'test')
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
      roots.set(clause.namedBindings.name.text, 'namespace')
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const specifier of clause.namedBindings.elements) {
        const imported = (specifier.propertyName ?? specifier.name).text
        if (!specifier.isTypeOnly && (testNames.has(imported) || suiteNames.has(imported)))
          roots.set(specifier.name.text, testNames.has(imported) ? 'test' : 'suite')
      }
    }
  }
  const shadowed = new Set<string>()
  let nodes = 0
  // Conservatively withhold a test binding if the file redeclares it in any scope.
  function declarations(node: ts.Node, depth: number) {
    if (++nodes > 20000 || depth > 100 || performance.now() > deadline)
      throw new Error('符号分析预算已耗尽')
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && !(ts.isVariableDeclaration(node) && importedVariables.has(node)) && node.name) {
      const names = (name: ts.BindingName | ts.DeclarationName): string[] => ts.isIdentifier(name) ? [name.text] : ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name) ? name.elements.flatMap(e => ts.isBindingElement(e) ? names(e.name) : []) : []
      for (const name of names(node.name)) {
        if (roots.has(name))
          shadowed.add(name)
      }
    }
    ts.forEachChild(node, child => declarations(child, depth + 1))
  }
  declarations(source, 0)
  nodes = 0
  function callKind(expression: ts.Expression): 'test' | 'suite' | undefined {
    if (ts.isCallExpression(expression) || ts.isTaggedTemplateExpression(expression))
      return callKind(ts.isCallExpression(expression) ? expression.expression : expression.tag)
    if (ts.isPropertyAccessExpression(expression)) {
      if (ts.isIdentifier(expression.expression) && roots.get(expression.expression.text) === 'namespace' && !shadowed.has(expression.expression.text))
        return testNames.has(expression.name.text) ? 'test' : suiteNames.has(expression.name.text) ? 'suite' : undefined
      const parent = callKind(expression.expression)
      if (parent && suiteNames.has(expression.name.text))
        return 'suite'
      if (parent === 'test' && testNames.has(expression.name.text))
        return 'test'
      return modifiers.has(expression.name.text) ? parent : undefined
    }
    if (!ts.isIdentifier(expression))
      return
    if (shadowed.has(expression.text)) {
      notes.add('测试标识符被重新声明，相关调用未计入。')
      return
    }
    const kind = roots.get(expression.text)
    return kind === 'namespace' ? undefined : kind
  }
  function knownTestRoot(expression: ts.Expression): boolean {
    if (ts.isCallExpression(expression) || ts.isPropertyAccessExpression(expression))
      return knownTestRoot(expression.expression)
    if (ts.isElementAccessExpression(expression))
      return knownTestRoot(expression.expression)
    if (ts.isTaggedTemplateExpression(expression))
      return knownTestRoot(expression.tag)
    return ts.isIdentifier(expression) && roots.has(expression.text)
  }
  function push(node: ts.Node, name: string, kind: SymbolRange['kind'], containers: string[], stable: boolean) {
    if (symbols.length >= 500)
      throw new Error('符号分析预算已耗尽')
    symbols.push({ name: [...containers, name].join(' › '), key: JSON.stringify([kind, ...containers, kind === 'callback' && !stable ? 'anonymous' : name]), kind, stable, start: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, end: source.getLineAndCharacterOfPosition(node.end).line + 1, text: node.getText(source) })
  }
  function visit(node: ts.Node, containers: string[], suites: string[], depth: number) {
    if (++nodes > 20000 || depth > 100 || performance.now() > deadline)
      throw new Error('符号分析预算已耗尽')
    if (ts.isCallExpression(node)) {
      const kind = callKind(node.expression)
      // An inner test.each(data) configures a template; only its outer declaration counts.
      const configuring = (ts.isCallExpression(node.parent) && node.parent.expression === node)
        || (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)
      const title = literal(node.arguments[0])
      if (kind && !configuring) {
        for (const argument of node.arguments) {
          if (executable(argument))
            testCallbacks.set(argument, { name: `${kind === 'test' ? 'test' : 'suite'}: ${title ?? '动态名称'}`, stable: title !== undefined && !suites.some(s => s.startsWith('动态套件@')) })
        }
        if (kind === 'test') {
          push(node, title ?? `动态用例@${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`, 'test', suites, title !== undefined && !suites.some(s => s.startsWith('动态套件@')))
          if (title === undefined)
            notes.add('动态用例名称无法稳定配对；仅统计静态声明，参数化和循环用例不展开。')
        }
        const nextSuites = kind === 'suite' ? [...suites, title ?? `动态套件@${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`] : suites
        if (kind === 'suite' && title === undefined)
          notes.add('动态测试套件无法稳定配对。')
        ts.forEachChild(node, child => visit(child, containers, nextSuites, depth + 1))
        return
      }
      if (testFile && ts.isPropertyAccessExpression(node.expression) && testNames.has(node.expression.name.text) && !kind)
        notes.add('存在未识别的测试调用，可能包含动态子用例。')
      if (!kind && knownTestRoot(node.expression))
        notes.add('存在未识别的测试调用形式，用例声明数量可能不完整。')
    }
    if (executable(node)) {
      const name = (node as ts.NamedDeclaration).name?.getText(source)
      const parentName = ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent) || ts.isPropertyDeclaration(node.parent) ? node.parent.name.getText(source) : undefined
      const callback = testCallbacks.get(node)
      const exportedDefault = (ts.isExportAssignment(node.parent) && !node.parent.isExportEquals) || (ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword))
      const label = ts.isConstructorDeclaration(node) ? 'constructor' : callback?.name || name || parentName || (exportedDefault ? 'default' : `callback@${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
      const method = ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node) || ts.isPropertyDeclaration(node.parent)
      const kind = method ? 'method' : callback ? 'callback' : ts.isFunctionDeclaration(node) || parentName || exportedDefault ? 'function' : 'callback'
      const qualified = `${ts.isGetAccessor(node) ? 'get ' : ts.isSetAccessor(node) ? 'set ' : ''}${label}`
      push(node, qualified, kind, containers, (kind !== 'callback' || callback?.stable === true) && !containers.some(c => c.startsWith('callback@')))
      ts.forEachChild(node, child => visit(child, [...containers, qualified], suites, depth + 1))
      return
    }
    const named = node as ts.NamedDeclaration
    const owner = (ts.isClassDeclaration(node) || ts.isModuleDeclaration(node)) && named.name ? [...containers, named.name.getText(source)] : containers
    ts.forEachChild(node, child => visit(child, owner, suites, depth + 1))
  }
  visit(source, [], [], 0)
  return { symbols, testNotes: [...notes] }
}
export function changedLines(hunk: ReviewHunk, side: 'old' | 'new') {
  const result: number[] = []
  let line = side === 'old' ? hunk.oldStart : hunk.newStart
  for (const text of hunk.lines) {
    if (text.startsWith('\\'))
      continue
    if (text[0] === (side === 'old' ? '-' : '+'))
      result.push(line)
    if (text[0] !== (side === 'old' ? '+' : '-'))
      line++
  }
  return result
}
export function symbolStatistics(path: string, oldIndex: SymbolIndex | undefined, newIndex: SymbolIndex | undefined, hunks: ReviewHunk[], targets: ReviewTarget[]): ReviewFileStatistics {
  const category = reviewFileCategory(path)
  const lines = { addedHunkIds: hunks.filter(h => h.lines.some(l => l.startsWith('+'))).map(h => h.id), removedHunkIds: hunks.filter(h => h.lines.some(l => l.startsWith('-'))).map(h => h.id) }
  if (!oldIndex || !newIndex) {
    return { ...lines, functionState: category === 'other' ? 'not-applicable' : 'unavailable', testState: category === 'test' ? 'unavailable' : 'not-applicable', changes: [], notes: category === 'other' ? [] : ['此文件未完成 TS/JS 符号解析，函数与用例数量未知。'] }
  }
  function byKey(symbols: SymbolRange[]) {
    const map = new Map<string, SymbolRange[]>()
    for (const symbol of symbols) map.set(symbol.key, [...map.get(symbol.key) ?? [], symbol])
    return map
  }
  const old = byKey(oldIndex.symbols)
  const next = byKey(newIndex.symbols)
  const changes: ReviewSymbolChange[] = []
  const notes = new Set([...oldIndex.testNotes, ...newIndex.testNotes])
  function add(before: SymbolRange | undefined, after: SymbolRange | undefined, ambiguous = false) {
    if (before?.text === after?.text)
      return
    const changed = hunks.filter(h => (['old', 'new'] as const).some((side) => {
      const symbol = side === 'old' ? before : after
      return symbol && changedLines(h, side).some(line => line >= symbol.start && line <= symbol.end)
    }))
    if (!changed.length)
      return
    const symbol = after ?? before!
    const hunkIds = changed.map(h => h.id)
    const matches = targets.filter(t => t.kind === 'function' && ((before && t.oldStart === before.start && t.oldEnd === before.end) || (after && t.newStart === after.start && t.newEnd === after.end)))
    // Test declarations usually wrap an anonymous callback; use intersecting targets as a fallback.
    const contained = targets.filter(t => (before && t.oldStart !== undefined && t.oldEnd !== undefined && t.oldStart >= before.start && t.oldEnd <= before.end) || (after && t.newStart !== undefined && t.newEnd !== undefined && t.newStart >= after.start && t.newEnd <= after.end))
    const targetIds = (matches.length ? matches : contained.length ? contained : targets.filter(t => t.hunkIds.some(id => hunkIds.includes(id)))).map(t => t.id)
    changes.push({ name: symbol.name, kind: symbol.kind, change: ambiguous ? 'unmatched' : before ? after ? 'modified' : 'deleted' : 'added', hunkIds, targetIds })
  }
  for (const key of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(key) ?? []
    const b = next.get(key) ?? []
    if (a.length <= 1 && b.length <= 1 && (a[0] ?? b[0])?.stable) {
      add(a[0], b[0])
    }
    else {
      // Exact anonymous bodies can survive line movement; never infer pairing from line numbers.
      const remaining = [...b]
      for (const before of a) {
        const same = remaining.findIndex(after => after.text === before.text)
        if (same >= 0)
          remaining.splice(same, 1)
        else
          add(before, undefined, true)
      }
      for (const after of remaining) add(undefined, after, true)
    }
  }
  if (changes.some(c => c.change === 'unmatched'))
    notes.add('匿名或重名声明无法唯一配对，单列为未配对，不推断新增或删除。')
  const hasTests = category === 'test' || [...oldIndex.symbols, ...newIndex.symbols].some(s => s.kind === 'test')
  return { ...lines, functionState: 'complete', testState: hasTests ? oldIndex.testNotes.length || newIndex.testNotes.length ? 'partial' : 'complete' : 'not-applicable', changes, notes: [...notes] }
}
