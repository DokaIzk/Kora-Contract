import { FxService } from '../src/services/fxService';

describe('Currency and Locale FX Service (#784)', () => {
  let fx: FxService;

  beforeEach(() => {
    fx = new FxService();
  });

  it('should return default FX rates for supported African currencies', () => {
    const ngnRate = fx.getRate('NGN');
    expect(ngnRate.currency).toBe('NGN');
    expect(ngnRate.rateToUsd).toBe(1520.5);
    expect(ngnRate.isStale).toBe(false);

    const kesRate = fx.getRate('KES');
    expect(kesRate.rateToUsd).toBe(130.2);
  });

  it('should convert USD to local currencies correctly', () => {
    const amountUsd = 1000;
    const { convertedAmount, rateData } = fx.convertFromUsd(amountUsd, 'NGN');

    expect(convertedAmount).toBe(1520500);
    expect(rateData.currency).toBe('NGN');
  });

  it('should detect stale rates when timestamp exceeds threshold', () => {
    const oldTimestamp = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
    fx.updateRate('ZAR', 19.5, oldTimestamp);

    const zarRate = fx.getRate('ZAR');
    expect(zarRate.rateToUsd).toBe(19.5);
    expect(zarRate.isStale).toBe(true);
  });
});
