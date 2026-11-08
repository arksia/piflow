import type { ReviewDetail } from '@piflow/protocol'
import type { ReviewStatisticsFilter } from './review-model'
import { categoryLabels, changeLabels, reviewStatistics, statisticsLabel } from './review-model'
import styles from './review.module.css'

export default function ReviewStatistics({ detail, filter, onFilter }: { detail: ReviewDetail, filter?: ReviewStatisticsFilter, onFilter: (filter?: ReviewStatisticsFilter) => void }) {
  const rows = reviewStatistics(detail)
  const partial = detail.gaps.some(g => ['source-not-captured', 'comparison-unavailable', 'diff-budget', 'target-budget', 'symbol-budget'].includes(g.kind))
  function metric(value: number, selection: ReviewStatisticsFilter, label: string) {
    const active = filter?.category === selection.category && filter.metric === selection.metric && filter.change === selection.change
    return <button key={statisticsLabel(selection)} type="button" aria-label={`${statisticsLabel(selection)} ${value}`} aria-pressed={active} data-metric={selection.metric} disabled={!value} onClick={() => onFilter(active ? undefined : selection)}>{label}</button>
  }
  return (
    <section className={styles.statistics} aria-label="固定修订变更统计">
      <div className={styles.statisticsHeading}>
        <span>
          变更规模
          <small>{partial ? '部分统计' : '固定比较'}</small>
        </span>
        {filter ? <button type="button" onClick={() => onFilter()}>清除筛选</button> : null}
      </div>
      {rows.map(row => (
        <div className={styles.statisticsRow} key={row.category}>
          <strong>{categoryLabels[row.category]}</strong>
          <div className={styles.statisticsMetrics}>
            {metric(row.fileCount, { category: row.category, metric: 'files' }, `${row.fileCount} 文件`)}
            {metric(row.added, { category: row.category, metric: 'added-lines' }, `+${row.added}`)}
            {metric(row.removed, { category: row.category, metric: 'removed-lines' }, `−${row.removed}`)}
          </div>
          {(['functions', 'tests'] as const).map((kind) => {
            const available = kind === 'functions' ? row.functionFiles : row.testFiles
            const incomplete = kind === 'functions' ? row.incompleteFunctions : row.incompleteTests
            if (row.category === 'other' && !available)
              return null
            if (kind === 'tests' && row.category !== 'test' && !available)
              return null
            return (
              <div className={styles.statisticsMetrics} key={kind}>
                <span>{kind === 'functions' ? '函数/方法' : '用例声明'}</span>
                {available
                  ? (['added', 'modified', 'deleted'] as const).map(change => metric(row[kind].filter(c => c.change === change).length, { category: row.category, metric: kind, change }, `${changeLabels[change]} ${row[kind].filter(c => c.change === change).length}`))
                  : <span>未知</span>}
                {row[kind].some(c => c.change === 'unmatched') ? metric(row[kind].filter(c => c.change === 'unmatched').length, { category: row.category, metric: kind, change: 'unmatched' }, `未配对 ${row[kind].filter(c => c.change === 'unmatched').length}`) : null}
                {available && incomplete ? <small>部分</small> : null}
              </div>
            )
          })}
        </div>
      ))}
      {filter
        ? (
            <p role="status">
              正在筛选：
              {statisticsLabel(filter)}
              ；统计仍按修订内可用范围计算。
            </p>
          )
        : null}
      <details className={styles.statisticsNotes}>
        <summary>统计口径与未配对声明</summary>
        <p>相对固定基线的文本变更，保留既有脏基线作为起点；文件按路径约定分组。TS/JS 可执行函数与类方法按同文件唯一名称配对，包含构造器与访问器；嵌套函数分别计数，匿名回调单列，未配对数量按单侧声明片段计。重命名、跨文件移动按增删统计，不表示新增业务能力。</p>
        <p>用例是 node:test、Vitest/Jest、Playwright、Bun 的静态 test/it 声明；参数化模板与循环内声明各计一次，不代表展开或实际执行数量，也不代表通过率。非 TS/JS 测试保留行数，声明数量未知。</p>
        {partial ? <p>存在未采集或未完成比较的文件，当前行数与声明统计仅覆盖可用部分。</p> : null}
        {rows.map(row => (
          <div key={row.category}>
            {(['functions', 'tests'] as const).filter(kind => row[kind].some(c => c.change === 'unmatched')).map(kind => metric(row[kind].filter(c => c.change === 'unmatched').length, { category: row.category, metric: kind, change: 'unmatched' }, `${categoryLabels[row.category]} · ${kind === 'functions' ? '函数/方法' : '用例'}未配对 ${row[kind].filter(c => c.change === 'unmatched').length}`))}
            {row.callbacks.length
              ? (
                  <span>
                    {categoryLabels[row.category]}
                    {' '}
                    · 回调：
                  </span>
                )
              : null}
            {(['added', 'modified', 'deleted', 'unmatched'] as const).filter(change => row.callbacks.some(c => c.change === change)).map(change => metric(row.callbacks.filter(c => c.change === change).length, { category: row.category, metric: 'callbacks', change }, `${changeLabels[change]} ${row.callbacks.filter(c => c.change === change).length}`))}
            {row.notes.map(note => (
              <p key={note}>
                {categoryLabels[row.category]}
                ：
                {note}
              </p>
            ))}
          </div>
        ))}
      </details>
    </section>
  )
}
