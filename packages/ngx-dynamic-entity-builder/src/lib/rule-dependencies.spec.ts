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
});
