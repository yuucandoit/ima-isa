import { describe, expect, test } from 'bun:test'
import {
  booleanAstMatches,
  collectTerms,
  parseBooleanQuery,
  tryParseBooleanQuery,
} from './boolean'

describe('parseBooleanQuery', () => {
  test('parses a single term', () => {
    const ast = parseBooleanQuery('rupiah')
    expect(ast).toEqual({ type: 'term', value: 'rupiah' })
  })

  test('supports explicit AND / OR with precedence', () => {
    const ast = parseBooleanQuery('pemilu OR presiden AND dpr')
    expect(ast.type).toBe('or')
    expect(collectTerms(ast)).toEqual(['pemilu', 'presiden', 'dpr'])
  })

  test('supports parentheses and NOT', () => {
    const ast = parseBooleanQuery('(pemilu OR presiden) AND NOT hoaks')
    expect(ast.type).toBe('and')
    expect(booleanAstMatches(ast, 'pemilu 2029 berjalan lancar')).toBe(true)
    expect(booleanAstMatches(ast, 'pemilu dengan hoaks')).toBe(false)
    expect(booleanAstMatches(ast, 'hoaks pemilu')).toBe(false)
  })

  test('supports quoted phrases', () => {
    const ast = parseBooleanQuery('"bank indonesia" AND rupiah')
    expect(collectTerms(ast)).toEqual(['bank indonesia', 'rupiah'])
    expect(booleanAstMatches(ast, 'Bank Indonesia menahan rupiah')).toBe(true)
    expect(booleanAstMatches(ast, 'bank swasta menahan rupiah')).toBe(false)
  })

  test('supports the leading minus shorthand for negation', () => {
    const ast = parseBooleanQuery('banjir -hoaks')
    expect(booleanAstMatches(ast, 'banjir di bekasi')).toBe(true)
    expect(booleanAstMatches(ast, 'banjir hoaks')).toBe(false)
  })

  test('treats adjacent terms as implicit AND', () => {
    const ast = parseBooleanQuery('rupiah inflasi')
    expect(ast.type).toBe('and')
    expect(booleanAstMatches(ast, 'rupiah melemah, inflasi naik')).toBe(true)
    expect(booleanAstMatches(ast, 'rupiah melemah')).toBe(false)
  })

  test('understand Indonesian operators DAN / ATAU', () => {
    const ast = parseBooleanQuery('banjir DAN jakarta')
    expect(ast.type).toBe('and')
    expect(booleanAstMatches(ast, 'banjir jakarta utara')).toBe(true)
  })

  test('reports unbalanced parentheses', () => {
    const result = tryParseBooleanQuery('(pemilu OR presiden')
    expect(result.ok).toBe(false)
  })

  test('rejects an empty query', () => {
    const result = tryParseBooleanQuery('   ')
    expect(result.ok).toBe(false)
  })

  test('rejects unclosed quotes', () => {
    const result = tryParseBooleanQuery('"bank indonesia')
    expect(result.ok).toBe(false)
  })
})
