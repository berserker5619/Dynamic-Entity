import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BuilderStore } from '../builder-store.service';
import { BuilderTextService } from '../builder-text';
import { computeRuleDependencies, type DependencyType, type RuleDependencyEdge } from '../rule-dependencies';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngx-rule-dependency-graph',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
  ],
  template: `
    <div class="deb-graph-backdrop" (click)="onBackdropClick($event)">
      <div class="deb-graph-dialog" role="dialog" aria-modal="true" data-testid="rule-graph-dialog">
        <div class="deb-graph-header">
          <div class="deb-graph-header__titles">
            <div class="deb-graph-header__title-row">
              <mat-icon class="deb-graph-icon">hub</mat-icon>
              <h2 class="deb-graph-title">{{ ui.text('ruleGraphTitle') }}</h2>
            </div>
            <p class="deb-graph-subtitle">{{ ui.text('ruleGraphSubtitle') }}</p>
          </div>
          <button
            mat-icon-button
            type="button"
            data-testid="close-rule-graph"
            [matTooltip]="ui.text('closeDialog')"
            (click)="dismiss.emit()"
          >
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <div class="deb-graph-metrics">
          <span class="deb-metric-pill deb-metric-pill--rule">
            <mat-icon>rule</mat-icon>
            {{ graphData().totalRules }} {{ ui.text('dependencyTypeRule') }}
          </span>
          <span class="deb-metric-pill deb-metric-pill--show-when">
            <mat-icon>visibility</mat-icon>
            {{ graphData().totalShowWhen }} {{ ui.text('dependencyTypeShowWhen') }}
          </span>
          <span class="deb-metric-pill deb-metric-pill--cascade">
            <mat-icon>account_tree</mat-icon>
            {{ graphData().totalCascades }} {{ ui.text('dependencyTypeCascade') }}
          </span>
          <span class="deb-metric-pill deb-metric-pill--patch">
            <mat-icon>content_copy</mat-icon>
            {{ graphData().totalPatches }} {{ ui.text('dependencyTypePatch') }}
          </span>
        </div>

        <div class="deb-graph-controls">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="deb-graph-search">
            <mat-icon matPrefix>search</mat-icon>
            <input
              matInput
              data-testid="filter-dependencies-input"
              [placeholder]="ui.text('filterDependencies')"
              [ngModel]="filterQuery()"
              (ngModelChange)="filterQuery.set($event)"
            />
            @if (filterQuery()) {
              <button mat-icon-button matSuffix type="button" (click)="filterQuery.set('')">
                <mat-icon>clear</mat-icon>
              </button>
            }
          </mat-form-field>

          <div class="deb-graph-filter-types">
            <button
              type="button"
              class="deb-filter-btn"
              [class.deb-filter-btn--active]="selectedType() === 'all'"
              (click)="selectedType.set('all')"
            >
              All ({{ graphData().edges.length }})
            </button>
            <button
              type="button"
              class="deb-filter-btn"
              [class.deb-filter-btn--active]="selectedType() === 'rule'"
              (click)="selectedType.set('rule')"
            >
              {{ ui.text('dependencyTypeRule') }}
            </button>
            <button
              type="button"
              class="deb-filter-btn"
              [class.deb-filter-btn--active]="selectedType() === 'showWhen'"
              (click)="selectedType.set('showWhen')"
            >
              {{ ui.text('dependencyTypeShowWhen') }}
            </button>
            <button
              type="button"
              class="deb-filter-btn"
              [class.deb-filter-btn--active]="selectedType() === 'cascade'"
              (click)="selectedType.set('cascade')"
            >
              {{ ui.text('dependencyTypeCascade') }}
            </button>
            <button
              type="button"
              class="deb-filter-btn"
              [class.deb-filter-btn--active]="selectedType() === 'patchOnTrue'"
              (click)="selectedType.set('patchOnTrue')"
            >
              {{ ui.text('dependencyTypePatch') }}
            </button>
          </div>
        </div>

        <div class="deb-graph-body" data-testid="rule-graph-edges">
          @if (filteredEdges().length === 0) {
            <div class="deb-graph-empty" data-testid="no-dependencies-found">
              <mat-icon>search_off</mat-icon>
              <p>{{ ui.text('noDependenciesFound') }}</p>
            </div>
          }

          @for (edge of filteredEdges(); track edge.id) {
            <div class="deb-edge-card" [attr.data-testid]="'edge-card-' + edge.id">
              <!-- Source -->
              <button
                type="button"
                class="deb-node-chip deb-node-chip--source"
                [matTooltip]="ui.text('jumpToField', { field: edge.sourceLabel })"
                (click)="onNodeClick(edge.sourceKey)"
              >
                <mat-icon class="deb-node-chip__icon">tune</mat-icon>
                <span class="deb-node-chip__label">{{ edge.sourceLabel }}</span>
                <span class="deb-node-chip__key">{{ edge.sourceKey }}</span>
              </button>

              <!-- Connection details -->
              <div class="deb-edge-flow">
                <span
                  class="deb-edge-badge"
                  [class.deb-edge-badge--rule]="edge.type === 'rule'"
                  [class.deb-edge-badge--show-when]="edge.type === 'showWhen'"
                  [class.deb-edge-badge--cascade]="edge.type === 'cascade'"
                  [class.deb-edge-badge--patch]="edge.type === 'patchOnTrue' || edge.type === 'autoPatch'"
                >
                  {{ typeName(edge.type) }}
                </span>
                <span class="deb-edge-arrow">
                  <span class="deb-edge-summary">{{ edge.actionSummary }}</span>
                  <mat-icon class="deb-edge-arrow-icon">arrow_forward</mat-icon>
                </span>
                <span class="deb-edge-desc">{{ edge.description }}</span>
              </div>

              <!-- Target -->
              <button
                type="button"
                class="deb-node-chip deb-node-chip--target"
                [matTooltip]="ui.text('jumpToField', { field: edge.targetLabel })"
                (click)="onNodeClick(edge.targetKey)"
              >
                <mat-icon class="deb-node-chip__icon">output</mat-icon>
                <span class="deb-node-chip__label">{{ edge.targetLabel }}</span>
                <span class="deb-node-chip__key">{{ edge.targetKey }}</span>
              </button>
            </div>
          }
        </div>

        <div class="deb-graph-footer">
          <span class="deb-graph-count">
            {{ ui.text('totalDependencies', { count: filteredEdges().length }) }}
          </span>
          <button mat-flat-button color="primary" type="button" (click)="dismiss.emit()">
            {{ ui.text('closeDialog') }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .deb-graph-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 24px;
        animation: debFadeIn 0.15s ease-out;
      }
      @keyframes debFadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .deb-graph-dialog {
        background: var(--deb-surface, #ffffff);
        border: 1px solid var(--deb-border, #e2e8f0);
        border-radius: 14px;
        width: 100%;
        max-width: 960px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        overflow: hidden;
      }
      .deb-graph-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 20px 24px 16px;
        border-bottom: 1px solid var(--deb-border, #e2e8f0);
      }
      .deb-graph-header__title-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .deb-graph-icon {
        color: var(--deb-accent, #6366f1);
        font-size: 26px;
        width: 26px;
        height: 26px;
      }
      .deb-graph-title {
        font-size: 18px;
        font-weight: 700;
        color: #0f172a;
        margin: 0;
      }
      .deb-graph-subtitle {
        font-size: 13px;
        color: var(--deb-muted, #64748b);
        margin: 4px 0 0;
      }
      .deb-graph-metrics {
        display: flex;
        gap: 12px;
        padding: 12px 24px;
        background: #f8fafc;
        border-bottom: 1px solid var(--deb-border, #e2e8f0);
        flex-wrap: wrap;
      }
      .deb-metric-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px;
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 600;
        border: 1px solid transparent;
      }
      .deb-metric-pill mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
      .deb-metric-pill--rule {
        background: #eef2ff;
        color: #4f46e5;
        border-color: #c7d2fe;
      }
      .deb-metric-pill--show-when {
        background: #f0fdf4;
        color: #16a34a;
        border-color: #bbf7d0;
      }
      .deb-metric-pill--cascade {
        background: #fefce8;
        color: #ca8a04;
        border-color: #fef08a;
      }
      .deb-metric-pill--patch {
        background: #fdf2f8;
        color: #db2777;
        border-color: #fbcfe8;
      }
      .deb-graph-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 24px;
        border-bottom: 1px solid var(--deb-border, #e2e8f0);
        flex-wrap: wrap;
      }
      .deb-graph-search {
        flex: 1;
        min-width: 240px;
      }
      .deb-graph-filter-types {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .deb-filter-btn {
        padding: 5px 12px;
        border-radius: 6px;
        border: 1px solid var(--deb-border, #e2e8f0);
        background: #ffffff;
        font-size: 12px;
        font-weight: 500;
        color: #475569;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .deb-filter-btn:hover {
        background: #f1f5f9;
        color: #0f172a;
      }
      .deb-filter-btn--active {
        background: var(--deb-accent, #6366f1);
        color: #ffffff;
        border-color: var(--deb-accent, #6366f1);
      }
      .deb-filter-btn--active:hover {
        background: var(--deb-accent-hover, #4f46e5);
      }
      .deb-graph-body {
        flex: 1;
        overflow-y: auto;
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .deb-graph-empty {
        text-align: center;
        padding: 48px 16px;
        color: var(--deb-muted, #64748b);
      }
      .deb-graph-empty mat-icon {
        font-size: 40px;
        width: 40px;
        height: 40px;
        margin-bottom: 8px;
        opacity: 0.5;
      }
      .deb-edge-card {
        display: grid;
        grid-template-columns: 220px 1fr 220px;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        background: #ffffff;
        border: 1px solid var(--deb-border, #e2e8f0);
        border-radius: 10px;
        transition: box-shadow 0.15s ease, border-color 0.15s ease;
      }
      .deb-edge-card:hover {
        border-color: #cbd5e1;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
      }
      .deb-node-chip {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 8px 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        cursor: pointer;
        text-align: left;
        width: 100%;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .deb-node-chip:hover {
        background: #f1f5f9;
        border-color: var(--deb-accent, #6366f1);
      }
      .deb-node-chip__icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--deb-accent, #6366f1);
        margin-bottom: 2px;
      }
      .deb-node-chip__label {
        font-size: 13px;
        font-weight: 600;
        color: #0f172a;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 190px;
      }
      .deb-node-chip__key {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 11px;
        color: var(--deb-muted, #64748b);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 190px;
      }
      .deb-edge-flow {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        text-align: center;
      }
      .deb-edge-badge {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 2px 8px;
        border-radius: 4px;
      }
      .deb-edge-badge--rule {
        background: #eef2ff;
        color: #4f46e5;
      }
      .deb-edge-badge--show-when {
        background: #f0fdf4;
        color: #16a34a;
      }
      .deb-edge-badge--cascade {
        background: #fefce8;
        color: #a16207;
      }
      .deb-edge-badge--patch {
        background: #fdf2f8;
        color: #be185d;
      }
      .deb-edge-arrow {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #475569;
      }
      .deb-edge-summary {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 12px;
        font-weight: 600;
        background: #f1f5f9;
        padding: 2px 8px;
        border-radius: 4px;
      }
      .deb-edge-arrow-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--deb-muted, #64748b);
      }
      .deb-edge-desc {
        font-size: 11px;
        color: var(--deb-muted, #64748b);
      }
      .deb-graph-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 24px;
        border-top: 1px solid var(--deb-border, #e2e8f0);
        background: #f8fafc;
      }
      .deb-graph-count {
        font-size: 13px;
        color: var(--deb-muted, #64748b);
      }
      @media (max-width: 768px) {
        .deb-edge-card {
          grid-template-columns: 1fr;
          gap: 8px;
        }
      }
    `,
  ],
})
export class RuleDependencyGraphComponent {
  protected readonly ui = inject(BuilderTextService);
  protected readonly store = inject(BuilderStore);

  @Output() readonly dismiss = new EventEmitter<void>();
  @Output() readonly selectField = new EventEmitter<string>();

  protected readonly filterQuery = signal('');
  protected readonly selectedType = signal<DependencyType | 'all'>('all');

  protected readonly graphData = computed(() =>
    computeRuleDependencies(this.store.config(), this.store.rules(), this.ui.language()),
  );

  protected readonly filteredEdges = computed<RuleDependencyEdge[]>(() => {
    const q = this.filterQuery().trim().toLowerCase();
    const type = this.selectedType();
    return this.graphData().edges.filter(edge => {
      if (type !== 'all' && edge.type !== type) return false;
      if (!q) return true;
      return (
        edge.sourceLabel.toLowerCase().includes(q) ||
        edge.sourceKey.toLowerCase().includes(q) ||
        edge.targetLabel.toLowerCase().includes(q) ||
        edge.targetKey.toLowerCase().includes(q) ||
        edge.actionSummary.toLowerCase().includes(q) ||
        edge.description.toLowerCase().includes(q)
      );
    });
  });

  protected typeName(type: DependencyType): string {
    switch (type) {
      case 'rule':
        return this.ui.text('dependencyTypeRule');
      case 'showWhen':
        return this.ui.text('dependencyTypeShowWhen');
      case 'cascade':
        return this.ui.text('dependencyTypeCascade');
      case 'patchOnTrue':
      case 'autoPatch':
        return this.ui.text('dependencyTypePatch');
    }
  }

  protected onNodeClick(key: string): void {
    if (!key) return;
    this.selectField.emit(key);
    this.dismiss.emit();
  }

  protected onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('deb-graph-backdrop')) {
      this.dismiss.emit();
    }
  }
}
