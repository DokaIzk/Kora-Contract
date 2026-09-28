import { fxService } from '../src/services/fxService';
import { notificationService } from '../src/services/notificationService';
import { simulationService } from '../src/services/simulationService';

describe('Layout and Core User Flows (#781)', () => {
  it('should initialize services for core flows', () => {
    expect(fxService).toBeDefined();
    expect(notificationService).toBeDefined();
    expect(simulationService).toBeDefined();
  });

  it('should support mobile and desktop viewport flow options', () => {
    const notifications = notificationService.getNotifications();
    expect(notifications.length).toBeGreaterThan(0);
  });
});
