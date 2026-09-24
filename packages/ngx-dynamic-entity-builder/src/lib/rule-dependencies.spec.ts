import type { EntityFormConfig, FormRule } from '@dynamic-entity/core';
import { computeRuleDependencies } from './rule-dependencies';

describe('computeRuleDependencies', () => {
  const config: EntityFormConfig = {
    entity: 'test-entity',
    version: 1,
    defaultLanguage: 'en',
    tabs: [
      {
        id: 'main',
        label: { en: 'Main' },
        fields: [
          {
            id: 'hasAllergies',
            type: 'boolean',
            label: { en: 'Has Allergies' },
            patchOnTrue: [{ from: 'defaultNotes', to: 'allergyDetails' }],
          },
          {
            id: 'defaultNotes',
            type: 'text',
            label: { en: 'Default Notes' },
          },
          {
            id: 'allergyDetails',
            type: 'textarea',
            label: { en: 'Allergy Details' },
            showWhen: { hasAllergies: true },
          },
          {
            id: 'country',
            type: 'entity-ref',
            label: { en: 'Country' },
          },
          {
            id: 'city',
            type: 'dropdown',
            label: { en: 'City' },
            entityReference: {
              enabled: true,
              parentField: 'country',
            },
          },
        ],
      },
    ],
  };

  const rules: FormRule[] = [
    {
      id: 'r1',
      formConfigId: 'test-entity',
      fieldId: 'hasAllergies',
      action: { type: 'visibility', value: true },
      conditions: [{ operator: 'EQUAL', compareType: 'value', value: true }],
      targets: [{ id: 'allergyDetails', type: 'field' }],
      enabled: true,
      priority: 1,
    },
  ];

  it('extracts showWhen, rules, cascades, and patchOnTrue edges', () => {
    const data = computeRuleDependencies(config, rules, 'en');

    expect(data.totalRules).toBe(1);
    expect(data.totalShowWhen).toBe(1);
    expect(data.totalCascades).toBe(1);
    expect(data.totalPatches).toBe(1);

    // Rule edge
    const ruleEdge = data.edges.find(e => e.type === 'rule');
    expect(ruleEdge).toBeDefined();
    expect(ruleEdge?.sourceKey).toContain('hasAllergies');
    expect(ruleEdge?.targetKey).toContain('allergyDetails');
    expect(ruleEdge?.actionSummary).toBe('show');

    // showWhen edge
    const showWhenEdge = data.edges.find(e => e.type === 'showWhen');
    expect(showWhenEdge).toBeDefined();
    expect(showWhenEdge?.sourceKey).toContain('hasAllergies');
    expect(showWhenEdge?.targetKey).toContain('allergyDetails');
    expect(showWhenEdge?.actionSummary).toBe('= true');

    // Cascade edge
    const cascadeEdge = data.edges.find(e => e.type === 'cascade');
    expect(cascadeEdge).toBeDefined();
    expect(cascadeEdge?.sourceKey).toContain('country');
    expect(cascadeEdge?.targetKey).toContain('city');

    // PatchOnTrue edge
    const patchEdge = data.edges.find(e => e.type === 'patchOnTrue');
    expect(patchEdge).toBeDefined();
    expect(patchEdge?.sourceKey).toContain('hasAllergies');
    expect(patchEdge?.targetKey).toContain('allergyDetails');
  });

  it('flags broken/missing field references as not valid', () => {
    const brokenRules: FormRule[] = [
      {
        id: 'r2',
        formConfigId: 'test-entity',
        fieldId: 'nonExistentTrigger',
        action: { type: 'visibility', value: false },
        conditions: [{ operator: 'EQUAL', compareType: 'value', value: 'bad' }],
        targets: [{ id: 'ghostTarget', type: 'field' }],
        enabled: true,
        priority: 1,
      },
    ];

    const data = computeRuleDependencies(config, brokenRules, 'en');
    const broken = data.edges.find(e => e.sourceKey === 'nonExistentTrigger');
    expect(broken).toBeDefined();
    expect(broken?.sourceValid).toBe(false);
    expect(broken?.targetValid).toBe(false);
  });

  it('handles null or undefined config gracefully', () => {
    const dataNull = computeRuleDependencies(null);
    expect(dataNull.edges).toEqual([]);
    expect(dataNull.totalRules).toBe(0);

    const dataUndefined = computeRuleDependencies(undefined);
    expect(dataUndefined.edges).toEqual([]);
  });

  it('handles autoPatch, action types (validation, info, hide), and showWhen object values', () => {
    const complexConfig: EntityFormConfig = {
      entity: 'complex',
      tabs: [
        {
          id: 'tab1',
          label: { en: 'Tab 1' },
          fields: [
            {
              id: 'sourceField',
              type: 'text',
              label: { en: 'Source' },
              autoPatch: {
                targetTab: 'tab1',
                mappings: [
                  { source: 'x', target: 'targetField' },
                  { source: 'y', target: '' as any },
                ],
              },
              patchOnTrue: [
                { from: 'sourceField', to: '' as any },
              ],
            },
            {
              id: 'targetField',
              type: 'text',
              label: { en: 'Target' },
              showWhen: {
                sourceField: { nested: 'value' } as any,
              },
            },
          ],
        },
      ],
    };

    const variedRules: FormRule[] = [
      {
        id: 'r_hide',
        formConfigId: 'complex',
        fieldId: 'sourceField',
        action: { type: 'visibility', value: false },
        conditions: [],
        targets: [{ id: 'targetField', type: 'field' }],
        enabled: true,
        priority: 1,
      },
      {
        id: 'r_val',
        formConfigId: 'complex',
        fieldId: 'sourceField',
        action: { type: 'validation', value: 'error' },
        conditions: [],
        targets: [{ id: 'targetField', type: 'field' }],
        enabled: true,
        priority: 2,
      },
      {
        id: 'r_info',
        formConfigId: 'complex',
        fieldId: 'sourceField',
        action: { type: 'infoBanner' as any, value: 'notice' },
        conditions: [],
        targets: [{ id: 'targetField', type: 'field' }],
        enabled: true,
        priority: 3,
      },
      {
        id: 'r_skip',
        formConfigId: 'complex',
        fieldId: '',
        action: { type: 'visibility', value: true },
        conditions: [],
        targets: [],
        enabled: true,
        priority: 4,
      },
    ];

    const data = computeRuleDependencies(complexConfig, variedRules);
    expect(data.totalRules).toBe(3);
    expect(data.totalPatches).toBe(1);
    expect(data.totalShowWhen).toBe(1);

    const hideEdge = data.edges.find(e => e.actionSummary === 'hide');
    expect(hideEdge).toBeDefined();
    expect(hideEdge?.description).toContain('HIDE when always');

    const valEdge = data.edges.find(e => e.actionSummary === 'validate');
    expect(valEdge).toBeDefined();

    const infoEdge = data.edges.find(e => e.actionSummary === 'info');
    expect(infoEdge).toBeDefined();

    const autoPatchEdge = data.edges.find(e => e.type === 'autoPatch');
    expect(autoPatchEdge).toBeDefined();

    const showWhenEdge = data.edges.find(e => e.type === 'showWhen');
    expect(showWhenEdge).toBeDefined();
    expect(showWhenEdge?.description).toContain('{"nested":"value"}');
  });
});
