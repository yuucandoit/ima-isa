import { describe, expect, test } from 'bun:test'
import type { SocialTrendItem } from '@media-intel/types'
import { sortTrendItems } from './sort'

function item(partial: Partial<SocialTrendItem> & Pick<SocialTrendItem, 'name' | 'type'>): SocialTrendItem {
  return {
    name: partial.name,
    type: partial.type,
    platform: partial.platform ?? 'GOOGLE_TRENDS',
    rank: partial.rank ?? null,
    volume: partial.volume ?? 0,
    volumeLabel: partial.volumeLabel ?? null,
    deltaPct: null,
    negativeRatio: 0,
    sourceCount: 0,
    url: null,
    imageUrl: null,
    sourceName: null,
    publishedAt: null,
    lastSeenAt: null,
    windowHours: null,
    relatedQueries: [],
    newsCount: null,
    dataSource: null,
  }
}

describe('sortTrendItems', () => {
  test('Google Trends diurutkan dari volume penelusuran terbesar', () => {
    const items = [
      item({ name: 'trip', type: 'google_search', rank: 1, volume: 200 }),
      item({ name: 'demo jogja', type: 'google_search', rank: 2, volume: 1000 }),
      item({ name: '76ers vs celtics', type: 'google_search', rank: 6, volume: 2000 }),
      item({ name: 'coco gauff', type: 'google_search', rank: 9, volume: 100 }),
    ]

    expect(sortTrendItems(items).map((entry) => entry.name)).toEqual([
      '76ers vs celtics',
      'demo jogja',
      'trip',
      'coco gauff',
    ])
  })

  test('volume sama kembali ke peringkat feed', () => {
    const items = [
      item({ name: 'kedua', type: 'google_search', rank: 2, volume: 200 }),
      item({ name: 'pertama', type: 'google_search', rank: 1, volume: 200 }),
    ]

    expect(sortTrendItems(items).map((entry) => entry.name)).toEqual(['pertama', 'kedua'])
  })

  test('mode rank menghormati urutan feed', () => {
    const items = [
      item({ name: 'trip', type: 'google_search', rank: 1, volume: 200 }),
      item({ name: 'demo jogja', type: 'google_search', rank: 2, volume: 1000 }),
    ]

    expect(sortTrendItems(items, 'rank').map((entry) => entry.name)).toEqual(['trip', 'demo jogja'])
  })

  test('X tanpa volume tetap urut peringkat dan tidak bercampur Google', () => {
    const items = [
      item({ name: 'google', type: 'google_search', rank: 1, volume: 2000 }),
      item({ name: 'x-2', type: 'x_trend', platform: 'TWITTER_X', rank: 2 }),
      item({ name: 'x-1', type: 'x_trend', platform: 'TWITTER_X', rank: 1 }),
    ]

    expect(sortTrendItems(items).map((entry) => entry.name)).toEqual(['x-1', 'x-2', 'google'])
  })

  test('hashtag sosial urut jumlah sebutan', () => {
    const items = [
      item({ name: 'jarang', type: 'hashtag', platform: 'TIKTOK', volume: 3 }),
      item({ name: 'sering', type: 'hashtag', platform: 'TIKTOK', volume: 42 }),
    ]

    expect(sortTrendItems(items).map((entry) => entry.name)).toEqual(['sering', 'jarang'])
  })

  test('tidak memutasi array masukan', () => {
    const items = [
      item({ name: 'b', type: 'google_search', rank: 2, volume: 10 }),
      item({ name: 'a', type: 'google_search', rank: 1, volume: 20 }),
    ]
    const snapshot = items.map((entry) => entry.name)

    sortTrendItems(items)

    expect(items.map((entry) => entry.name)).toEqual(snapshot)
  })
})
