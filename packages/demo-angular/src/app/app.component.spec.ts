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

  it('should toggle theme between light, dark, and auto', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    fixture.detectChanges();

    app.setTheme('dark');
    expect(app.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('demo-theme')).toBe('dark');

    app.setTheme('light');
    expect(app.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('demo-theme')).toBe('light');
  });

  it('should toggle JSON Inspector drawer and switch between schema and record data tabs', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    fixture.detectChanges();

    expect(app.showJsonInspector()).toBe(false);
    app.toggleJsonInspector();
    expect(app.showJsonInspector()).toBe(true);

    // default is config tab
    expect(app.jsonInspectorTab()).toBe('config');
    expect(app.activeJsonFilename()).toContain('-config.json');
    expect(app.activeJsonContent()).toContain('"entity"');

    // switch to record tab
    app.jsonInspectorTab.set('record');
    expect(app.jsonInspectorTab()).toBe('record');
    expect(app.activeJsonFilename()).toContain('-record.json');

    // close via close method
    app.closeJsonInspector();
    expect(app.showJsonInspector()).toBe(false);
  });
});
