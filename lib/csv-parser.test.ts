import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeBrandAliases, parseCSV } from './csv-parser'

test('mergeBrandAliases preserves built-in canonical brand aliases', () => {
  const merged = mergeBrandAliases({ OP: 'GEN', RE: 'GEN', REALME: 'GEN' })

  assert.equal(merged.OP, 'OP')
  assert.equal(merged.RE, 'RE')
  assert.equal(merged.REALME, 'RE')
})

test('parseCSV keeps OP/RE brand when alias table tries to override them', () => {
  const csv = `Description of Goods,Type of Goods,Quality,Quantity,Price,Unit\nOP RE 15T LCD FLEX 2023,LCD FLEX,,1,1,Unit\n`

  const rows = parseCSV(csv, {
    brandAliases: {
      OP: 'GEN',
      RE: 'GEN',
      OPPO: 'OP',
      REALME: 'RE',
      SAM: 'SAM',
      SM: 'SAM',
      VV: 'VV',
      VIVO: 'VV',
      IP: 'IP',
      IPHONE: 'IP',
      NK: 'NK',
      RM: 'RE',
      MI: 'MI',
      ONE: 'ONE',
      REDMI: 'RE',
      NOKIA: 'NK',
    },
    partAliases: { 'LCD FLEX': 'LCD' },
    colorAliases: {},
    validBrandCodes: ['OP', 'RE', 'SAM', 'VV', 'IP', 'NK', 'MI', 'ONE'],
  })

  assert.equal(rows[0]?.brandCode, 'RE')
  assert.equal(rows[0]?.generatedSku, 'RE-15T-2023-LCD')
})

test('parseCSV accepts generic brand with wire part', () => {
  const csv = `Description of Goods,Quantity,Price\nGENERIC 20MM WIRE,1,1\n`

  const rows = parseCSV(csv, {
    brandAliases: {
      OP: 'OP',
      RE: 'RE',
      OPPO: 'OP',
      REALME: 'RE',
      SAM: 'SAM',
      SM: 'SAM',
      VV: 'VV',
      VIVO: 'VV',
      IP: 'IP',
      IPHONE: 'IP',
      NK: 'NK',
      RM: 'RE',
      MI: 'MI',
      ONE: 'ONE',
      REDMI: 'RE',
      NOKIA: 'NK',
      GENERIC: 'GEN',
    },
    partAliases: { WIRE: 'WIRE', TOOL: 'TOOL', FLEX: 'FLEX' },
    colorAliases: {},
    validBrandCodes: ['OP', 'RE', 'SAM', 'VV', 'IP', 'NK', 'MI', 'ONE', 'GEN'],
  })

  assert.equal(rows[0]?.brandCode, 'GEN')
  assert.equal(rows[0]?.partCode, 'WIRE')
  assert.equal(rows[0]?.generatedSku, 'GEN-WIRE-20MM')
})

test('parseCSV keeps TECNO as brand, not generic', () => {
  const csv = `Description of Goods,Type of Goods,Quantity,Price\nTECNO SPARK 8 BACK PANEL,Back Panel,1,1\n`

  const rows = parseCSV(csv, {
    brandAliases: {
      OP: 'OP',
      RE: 'RE',
      OPPO: 'OP',
      REALME: 'RE',
      SAM: 'SAM',
      SM: 'SAM',
      VV: 'VV',
      VIVO: 'VV',
      IP: 'IP',
      IPHONE: 'IP',
      NK: 'NK',
      RM: 'RE',
      MI: 'MI',
      ONE: 'ONE',
      'ONE PLUS': 'ONE',
      ONEPLUS: 'ONE',
      REDMI: 'RE',
      NOKIA: 'NK',
      TEC: 'TEC',
      TECNO: 'TEC',
      GENERIC: 'GEN',
    },
    partAliases: { 'BACK PANEL': 'BP', BP: 'BP' },
    colorAliases: {},
    validBrandCodes: ['OP', 'RE', 'SAM', 'VV', 'IP', 'NK', 'MI', 'ONE', 'TEC', 'GEN'],
  })

  assert.equal(rows[0]?.brandCode, 'TEC')
  assert.equal(rows[0]?.partCode, 'BP')
  assert.equal(rows[0]?.generatedSku, 'TEC-SPARK-8-BP')
})

test('parseCSV keeps ONE PLUS as brand, not generic', () => {
  const csv = `Description of Goods,Type of Goods,Quantity,Price\nONE PLUS NORD CE 3 LITE LCD FLEX,LCD FLEX,1,1\n`

  const rows = parseCSV(csv, {
    brandAliases: {
      OP: 'OP',
      RE: 'RE',
      OPPO: 'OP',
      REALME: 'RE',
      SAM: 'SAM',
      SM: 'SAM',
      VV: 'VV',
      VIVO: 'VV',
      IP: 'IP',
      IPHONE: 'IP',
      NK: 'NK',
      RM: 'RE',
      MI: 'MI',
      ONE: 'ONE',
      'ONE PLUS': 'ONE',
      ONEPLUS: 'ONE',
      REDMI: 'RE',
      NOKIA: 'NK',
      TEC: 'TEC',
      TECNO: 'TEC',
      GENERIC: 'GEN',
    },
    partAliases: { 'LCD FLEX': 'LCD' },
    colorAliases: {},
    validBrandCodes: ['OP', 'RE', 'SAM', 'VV', 'IP', 'NK', 'MI', 'ONE', 'TEC', 'GEN'],
  })

  assert.equal(rows[0]?.brandCode, 'ONE')
  assert.equal(rows[0]?.partCode, 'LCD')
  assert.equal(rows[0]?.generatedSku, 'ONE-NORD-CE-3-LITE-LCD')
})
