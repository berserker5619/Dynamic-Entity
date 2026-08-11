import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-sample-module-tab',
  standalone: true,
  template: `
    <div style="padding: 16px; background: #f0f9ff; border: 1px dashed #0284c7; border-radius: 8px; margin-top: 12px;" data-testid="sample-module-tab">
      <h3 style="margin: 0 0 8px 0; color: #0369a1;">📁 Consumer Custom Module Tab</h3>
      <p style="margin: 0; font-size: 14px; color: #334155;">
        This dynamic Angular component was rendered directly via <strong>COMMON_MODULES_REGISTRY</strong>!
      </p>
      @if (moduleTitle) {
        <p style="margin-top: 8px; font-size: 13px; font-weight: 600;">Input moduleTitle: {{ moduleTitle }}</p>
      }
    </div>
  `,
})
export class SampleModuleTabComponent {
  @Input() moduleTitle?: string;
}
