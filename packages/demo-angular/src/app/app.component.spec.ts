import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();
  });

  it('should create the app and load default configs', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
    fixture.detectChanges();
    expect(app.allConfigs().length).toBeGreaterThan(0);
  });

  it('should render title and allow switching views', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Dynamic Entity Demo');

    const app = fixture.componentInstance;
    app.view.set('builder');
    fixture.detectChanges();
    expect(app.view()).toBe('builder');
  });
});
