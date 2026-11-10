import { sql, type SQL } from 'drizzle-orm'

/**
 * Boolean query parser for Indonesian media monitoring.
 *
 *   (pemilu OR presiden) AND NOT hoaks
 *   "bank indonesia" AND rupiah
 *   banjir -hoaks
 *
 * Supports explicit AND/OR/NOT, parentheses, quoted phrases, implicit AND and
 * the leading `-` shorthand for negation.
 */
export type BooleanNode =
  | { type: 'term'; value: string }
  | { type: 'and'; left: BooleanNode; right: BooleanNode }
  | { type: 'or'; left: BooleanNode; right: BooleanNode }
  | { type: 'not'; operand: BooleanNode }

class ParserError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message)
    this.name = 'ParserError'
  }
}

type Token =
  | { kind: 'AND' | 'OR' | 'NOT' | 'LPAREN' | 'RPAREN' }
  | { kind: 'TERM'; value: string; negated: boolean }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index]

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1
      continue
    }

    if (char === '(') {
      tokens.push({ kind: 'LPAREN' })
      index += 1
      continue
    }

    if (char === ')') {
      tokens.push({ kind: 'RPAREN' })
      index += 1
      continue
    }

    let negated = false
    if (char === '-' || char === '!') {
      negated = true
      index += 1
    }

    if (input[index] === '"') {
      index += 1
      let value = ''
      while (index < input.length && input[index] !== '"') {
        value += input[index]
        index += 1
      }
      if (input[index] !== '"') {
        throw new ParserError('Tanda kutip tidak ditutup.', index)
      }
      index += 1
      if (!value.trim()) throw new ParserError('Frasa kosong.', index)
      tokens.push({ kind: 'TERM', value: value.trim(), negated })
      continue
    }

    let value = ''
    while (index < input.length && !/[\s()]/.test(input[index] ?? '')) {
      value += input[index]
      index += 1
    }

    if (!value) {
      if (negated) throw new ParserError('Operator NOT tanpa operand.', index)
      index += 1
      continue
    }

    const upper = value.toUpperCase()
    if (!negated && (upper === 'AND' || upper === 'OR' || upper === 'NOT')) {
      tokens.push({ kind: upper as 'AND' | 'OR' | 'NOT' })
    } else if (!negated && (upper === 'DAN' || upper === 'ATAU')) {
      tokens.push({ kind: upper === 'DAN' ? 'AND' : 'OR' })
    } else if (!negated && upper === 'BUKAN') {
      tokens.push({ kind: 'NOT' })
    } else {
      tokens.push({ kind: 'TERM', value, negated })
    }
  }

  return tokens
}

export function parseBooleanQuery(input: string): BooleanNode {
  const tokens = tokenize(input)
  if (tokens.length === 0) throw new ParserError('Query Boolean kosong.', 0)

  let cursor = 0

  function peek(): Token | undefined {
    return tokens[cursor]
  }

  function consume(): Token {
    const token = tokens[cursor]
    if (!token) throw new ParserError('Query berakhir terlalu cepat.', input.length)
    cursor += 1
    return token
  }

  function startsExpression(token: Token | undefined): boolean {
    return token?.kind === 'TERM' || token?.kind === 'LPAREN' || token?.kind === 'NOT'
  }

  function parseOr(): BooleanNode {
    let left = parseAnd()
    while (peek()?.kind === 'OR') {
      consume()
      const right = parseAnd()
      left = { type: 'or', left, right }
    }
    return left
  }

  function parseAnd(): BooleanNode {
    let left = parseUnary()
    while (true) {
      const token = peek()
      if (token?.kind === 'AND') {
        consume()
        left = { type: 'and', left, right: parseUnary() }
        continue
      }
      // Implicit AND: `rupiah inflasi` === `rupiah AND inflasi`
      if (startsExpression(token)) {
        left = { type: 'and', left, right: parseUnary() }
        continue
      }
      break
    }
    return left
  }

  function parseUnary(): BooleanNode {
    const token = peek()
    if (token?.kind === 'NOT') {
      consume()
      return { type: 'not', operand: parseUnary() }
    }
    return parsePrimary()
  }

  function parsePrimary(): BooleanNode {
    const token = consume()
    if (token.kind === 'TERM') {
      const node: BooleanNode = { type: 'term', value: token.value }
      return token.negated ? { type: 'not', operand: node } : node
    }
    if (token.kind === 'LPAREN') {
      const node = parseOr()
      if (consume().kind !== 'RPAREN') {
        throw new ParserError('Tanda kurung tutup tidak ditemukan.', cursor)
      }
      return node
    }
    throw new ParserError(`Token tidak terduga: ${token.kind}.`, cursor)
  }

  const ast = parseOr()
  if (cursor !== tokens.length) {
    throw new ParserError('Token tersisa setelah query selesai.', cursor)
  }
  return ast
}

export function tryParseBooleanQuery(input: string): { ok: true; ast: BooleanNode } | { ok: false; error: string } {
  try {
    return { ok: true, ast: parseBooleanQuery(input) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Query tidak valid.' }
  }
}

function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1')
}

/**
 * Compile the AST into a parameterised Postgres ILIKE predicate across the
 * headline and the cleaned article body.
 */
export function booleanAstToSql(node: BooleanNode): SQL {
  switch (node.type) {
    case 'term': {
      const pattern = `%${escapeLike(node.value)}%`
      return sql`(media_items.title ILIKE ${pattern} OR media_items.clean_content ILIKE ${pattern})`
    }
    case 'and':
      return sql`(${booleanAstToSql(node.left)} AND ${booleanAstToSql(node.right)})`
    case 'or':
      return sql`(${booleanAstToSql(node.left)} OR ${booleanAstToSql(node.right)})`
    case 'not':
      return sql`(NOT ${booleanAstToSql(node.operand)})`
  }
}

export function booleanAstMatches(node: BooleanNode, text: string): boolean {
  const haystack = text.toLowerCase()
  switch (node.type) {
    case 'term':
      return haystack.includes(node.value.toLowerCase())
    case 'and':
      return booleanAstMatches(node.left, haystack) && booleanAstMatches(node.right, haystack)
    case 'or':
      return booleanAstMatches(node.left, haystack) || booleanAstMatches(node.right, haystack)
    case 'not':
      return !booleanAstMatches(node.operand, haystack)
  }
}

export function collectTerms(node: BooleanNode): string[] {
  switch (node.type) {
    case 'term':
      return [node.value]
    case 'and':
    case 'or':
      return [...collectTerms(node.left), ...collectTerms(node.right)]
    case 'not':
      return collectTerms(node.operand)
  }
}
