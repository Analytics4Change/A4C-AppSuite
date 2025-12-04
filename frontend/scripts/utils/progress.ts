/**
 * Progress reporting framework for long-running operations
 * Supports multiple display styles: bar, spinner, dots, none
 */

import cliProgress from 'cli-progress';
import ora from 'ora';
import { configManager } from '../config/manager.js';
import { getLogger } from './logger.js';
import { ProgressConfig } from '../config/types.js';

const logger = getLogger('progress');

export interface ProgressOptions {
  total: number;
  message?: string;
  style?: 'bar' | 'spinner' | 'dots' | 'none';
  showPercentage?: boolean;
  showEta?: boolean;
}

export interface ProgressReporter {
  start(message?: string): void;
  update(current: number, message?: string): void;
  increment(delta?: number, message?: string): void;
  complete(message?: string): void;
  fail(message?: string): void;
  stop(): void;
}

/**
 * Progress bar implementation using cli-progress
 */
class BarProgressReporter implements ProgressReporter {
  private bar: cliProgress.SingleBar;
  private total: number;
  private current: number = 0;
  
  constructor(options: ProgressOptions, config: ProgressConfig) {
    this.total = options.total;
    
    const format = this.createFormat(options, config);
    
    this.bar = new cliProgress.SingleBar({
      format,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
      fps: Math.max(1, Math.floor(1000 / config.refreshRate))
    });
  }
  
  start(message?: string): void {
    this.bar.start(this.total, 0, { message: message || 'Processing...' });
    logger.debug('Progress bar started', { total: this.total, message });
  }
  
  update(current: number, message?: string): void {
    this.current = Math.min(current, this.total);
    this.bar.update(this.current, { message: message || 'Processing...' });
  }
  
  increment(delta: number = 1, message?: string): void {
    this.current = Math.min(this.current + delta, this.total);
    this.bar.increment(delta, { message: message || 'Processing...' });
  }
  
  complete(message?: string): void {
    this.bar.update(this.total, { message: message || 'Complete!' });
    this.bar.stop();
    logger.debug('Progress bar completed', { message });
  }
  
  fail(message?: string): void {
    this.bar.stop();
    console.log(`\\n❌ ${message || 'Operation failed'}`);
    logger.debug('Progress bar failed', { message });
  }
  
  stop(): void {
    this.bar.stop();
  }
  
  private createFormat(options: ProgressOptions, config: ProgressConfig): string {
    let format = '{bar}';
    
    if (config.showPercentage) {
      format += ' | {percentage}%';
    }
    
    format += ' | {value}/{total}';
    
    if (config.showEta) {
      format += ' | ETA: {eta}s';
    }
    
    format += ' | {message}';
    
    return format;
  }
}

/**
 * Spinner implementation using ora
 */
class SpinnerProgressReporter implements ProgressReporter {
  private spinner: any;
  private total: number;
  private current: number = 0;
  
  constructor(options: ProgressOptions) {
    this.total = options.total;
    this.spinner = ora({
      text: options.message || 'Processing...',
      spinner: 'dots'
    });
  }
  
  start(message?: string): void {
    this.spinner.start(message || 'Processing...');
    logger.debug('Spinner started', { total: this.total, message });
  }
  
  update(current: number, message?: string): void {
    this.current = Math.min(current, this.total);
    const percentage = Math.round((this.current / this.total) * 100);
    this.spinner.text = `${message || 'Processing'} (${percentage}%)`;
  }
  
  increment(delta: number = 1, message?: string): void {
    this.current = Math.min(this.current + delta, this.total);
    const percentage = Math.round((this.current / this.total) * 100);
    this.spinner.text = `${message || 'Processing'} (${percentage}%)`;
  }
  
  complete(message?: string): void {
    this.spinner.succeed(message || 'Complete!');
    logger.debug('Spinner completed', { message });
  }
  
  fail(message?: string): void {
    this.spinner.fail(message || 'Operation failed');
    logger.debug('Spinner failed', { message });
  }
  
  stop(): void {
    this.spinner.stop();
  }
}

/**
 * Dots implementation for CI environments
 */
class DotsProgressReporter implements ProgressReporter {
  private total: number;
  private current: number = 0;
  private dotsPerLine: number = 50;
  private currentLine: number = 0;
  
  constructor(options: ProgressOptions) {
    this.total = options.total;
  }
  
  start(message?: string): void {
    console.log(message || 'Processing...');
    logger.debug('Dots progress started', { total: this.total, message });
  }
  
  update(current: number, _message?: string): void {
    const newCurrent = Math.min(current, this.total);
    const dotsToAdd = newCurrent - this.current;
    
    for (let i = 0; i < dotsToAdd; i++) {
      if (this.currentLine >= this.dotsPerLine) {
        process.stdout.write('\\n');
        this.currentLine = 0;
      }
      process.stdout.write('.');
      this.currentLine++;
    }
    
    this.current = newCurrent;
  }
  
  increment(delta: number = 1, message?: string): void {
    this.update(this.current + delta, message);
  }
  
  complete(message?: string): void {
    process.stdout.write('\\n');
    console.log(`✅ ${message || 'Complete!'}`);
    logger.debug('Dots progress completed', { message });
  }
  
  fail(message?: string): void {
    process.stdout.write('\\n');
    console.log(`❌ ${message || 'Operation failed'}`);
    logger.debug('Dots progress failed', { message });
  }
  
  stop(): void {
    process.stdout.write('\\n');
  }
}

/**
 * No-op implementation for when progress reporting is disabled
 */
class NoProgressReporter implements ProgressReporter {
  start(_message?: string): void {
    // No-op
  }

  update(_current: number, _message?: string): void {
    // No-op
  }

  increment(_delta?: number, _message?: string): void {
    // No-op
  }

  complete(_message?: string): void {
    // No-op
  }

  fail(_message?: string): void {
    // No-op
  }

  stop(): void {
    // No-op
  }
}

/**
 * Create a progress reporter based on configuration
 */
export function createProgress(options: ProgressOptions): ProgressReporter {
  const config = configManager.get('progress');
  const style = options.style || config.style;
  
  // In test environment, always use no progress
  if (configManager.isTest() || style === 'none') {
    return new NoProgressReporter();
  }
  
  switch (style) {
    case 'bar':
      return new BarProgressReporter(options, config);
    case 'spinner':
      return new SpinnerProgressReporter(options);
    case 'dots':
      return new DotsProgressReporter(options);
    default:
      logger.warn('Unknown progress style, falling back to none', { style });
      return new NoProgressReporter();
  }
}

/**
 * Progress tracking utility for arrays and iterables
 */
export class ProgressTracker {
  private reporter: ProgressReporter;
  private completed: number = 0;
  
  constructor(total: number, options: Partial<ProgressOptions> = {}) {
    this.reporter = createProgress({
      total,
      ...options
    });
  }
  
  /**
   * Start the progress tracking
   */
  start(message?: string): void {
    this.reporter.start(message);
  }
  
  /**
   * Mark one item as completed
   */
  tick(message?: string): void {
    this.completed++;
    this.reporter.increment(1, message);
  }
  
  /**
   * Mark multiple items as completed
   */
  tickMany(count: number, message?: string): void {
    this.completed += count;
    this.reporter.increment(count, message);
  }
  
  /**
   * Update to a specific completion count
   */
  setCompleted(count: number, message?: string): void {
    this.completed = count;
    this.reporter.update(count, message);
  }
  
  /**
   * Complete the progress tracking
   */
  complete(message?: string): void {
    this.reporter.complete(message);
  }
  
  /**
   * Mark the operation as failed
   */
  fail(message?: string): void {
    this.reporter.fail(message);
  }
  
  /**
   * Stop the progress tracking
   */
  stop(): void {
    this.reporter.stop();
  }
  
  /**
   * Get current completion count
   */
  getCompleted(): number {
    return this.completed;
  }
}

/**
 * Utility function to track progress for array processing
 */
export async function withProgress<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: Partial<ProgressOptions> = {}
): Promise<R[]> {
  const tracker = new ProgressTracker(items.length, options);
  const results: R[] = [];
  
  tracker.start(options.message || 'Processing items...');
  
  try {
    for (let i = 0; i < items.length; i++) {
      const result = await processor(items[i], i);
      results.push(result);
      tracker.tick(`Processed ${i + 1}/${items.length}`);
    }
    
    tracker.complete('All items processed successfully');
    return results;
  } catch (error) {
    tracker.fail(`Processing failed: ${error}`);
    throw error;
  }
}