import { describe, expect, it } from 'vitest';
import {
  commissionFor,
  duesToClear,
  freeRidesLeft,
  hasDues,
  isFreeRide,
  splitPayment,
} from './wallet-rules.js';

describe('free rides', () => {
  it('makes the first N trips free, then charges', () => {
    expect(isFreeRide(0, 10)).toBe(true);
    expect(isFreeRide(9, 10)).toBe(true);
    expect(isFreeRide(10, 10)).toBe(false);
    expect(isFreeRide(0, 0)).toBe(false);
  });

  it('counts what is left, never below zero', () => {
    expect(freeRidesLeft(3, 10)).toBe(7);
    expect(freeRidesLeft(12, 10)).toBe(0);
    expect(freeRidesLeft(0, 0)).toBe(0);
  });
});

describe('commissionFor', () => {
  it('takes the percentage, rounded to whole rupees', () => {
    expect(commissionFor(1062, 10)).toBe(106);
    expect(commissionFor(355, 12.5)).toBe(44);
  });

  it('is zero when there is no commission or no fare', () => {
    expect(commissionFor(1000, 0)).toBe(0);
    expect(commissionFor(0, 10)).toBe(0);
  });

  it('never takes more than the fare', () => {
    expect(commissionFor(100, 150)).toBe(100);
  });
});

describe('splitPayment', () => {
  it('takes it all from the wallet when the balance covers it', () => {
    expect(splitPayment(500, 800)).toEqual({ walletPaid: 500, cash: 0 });
  });

  it('collects the rest in cash when the balance is short', () => {
    expect(splitPayment(500, 320)).toEqual({ walletPaid: 320, cash: 180 });
  });

  it('is all cash with an empty or negative balance', () => {
    expect(splitPayment(500, 0)).toEqual({ walletPaid: 0, cash: 500 });
    expect(splitPayment(500, -40)).toEqual({ walletPaid: 0, cash: 500 });
  });
});

describe('dues', () => {
  it('has dues only below the minimum balance', () => {
    expect(hasDues(-500, -500)).toBe(false);
    expect(hasDues(-501, -500)).toBe(true);
    expect(duesToClear(-620, -500)).toBe(120);
    expect(duesToClear(200, -500)).toBe(0);
  });
});
