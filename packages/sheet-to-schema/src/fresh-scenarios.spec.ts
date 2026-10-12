import {
  applyMapping,
  suggestMapping,
  jsonSchemaAdapter,
  exampleJsonAdapter,
  validatePlan,
  readPlan,
  parseCsv,
  type MappingPlan,
} from './index';

describe('fresh sheet-to-schema end-to-end scenarios', () => {
  it('Scenario 1: maps and coerces spreadsheet rows against a JSON Schema with nested fields and split lists', () => {
    // Define a JSON Schema for employee onboarding
    const employeeSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'EmployeeRecord',
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        contact: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
          },
          required: ['email'],
        },
        salary: { type: 'number' },
        startDate: { type: 'string', format: 'date' },
        skills: {
          type: 'array',
          items: { type: 'string' },
        },
        isRemote: { type: 'boolean' },
      },
      required: ['id', 'name'],
    };

    const adapter = jsonSchemaAdapter(employeeSchema);
    expect(adapter.adapterVersion).toBe('1.0.0-rc.1');

    // Sample raw spreadsheet table (header row + data rows)
    const headers = [
      'Emp ID',
      'Full Name',
      'Email Address',
      'Telephone',
      'Annual Salary',
      'Start Date (DD/MM/YYYY)',
      'Skills List',
      'Remote Work',
    ];

    const rows = [
      [
        'EMP-101',
        'Sarah Connor',
        'sarah@sky.net',
        '+1-555-0199',
        '145,000.50',
        '15/08/2025',
        'TypeScript; Node.js; Angular',
        'yes',
      ],
      [
        'EMP-102',
        'John Connor',
        'john@resistance.org',
        '+1-555-0200',
        '120000',
        '01/09/2025',
        'Security; Cryptography',
        'true',
      ],
    ];

    // Automatically suggest mapping from headers
    const suggestion = suggestMapping(headers, adapter);
    expect(suggestion).toBeDefined();

    // Construct Plan v2
    const plan: MappingPlan = {
      planVersion: 2,
      target: adapter.id,
      schemaVersion: adapter.version,
      entries: [
        { column: 0, ref: 'id', header: 'Emp ID' },
        { column: 1, ref: 'name', header: 'Full Name' },
        { column: 2, ref: 'contact.email', header: 'Email Address' },
        { column: 3, ref: 'contact.phone', header: 'Telephone' },
        { column: 4, ref: 'salary', header: 'Annual Salary' },
        { column: 5, ref: 'startDate', header: 'Start Date (DD/MM/YYYY)', dateOrder: 'DMY' },
        { column: 6, ref: 'skills', header: 'Skills List', split: ';' },
        { column: 7, ref: 'isRemote', header: 'Remote Work' },
      ],
    };

    // Normalize and validate plan against adapter
    const { plan: normalizedPlan, problems } = readPlan(plan);
    expect(problems).toEqual([]);
    expect(normalizedPlan).toBeDefined();

    const planErrors = validatePlan(normalizedPlan!, adapter);
    expect(planErrors).toEqual([]);

    // Ingest and apply mapping
    const result = applyMapping(rows, plan, adapter, { headers });
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);

    const record1 = result.records[0];
    expect(record1['id']).toBe('EMP-101');
    expect(record1['name']).toBe('Sarah Connor');
    expect(record1['contact']).toEqual({
      email: 'sarah@sky.net',
      phone: '+1-555-0199',
    });
    expect(record1['salary']).toBe(145000.5);
    expect(record1['startDate']).toBe('2025-08-15');
    expect(record1['skills']).toEqual(['TypeScript', 'Node.js', 'Angular']);
    expect(record1['isRemote']).toBe(true);

    const record2 = result.records[1];
    expect(record2['id']).toBe('EMP-102');
    expect(record2['skills']).toEqual(['Security', 'Cryptography']);
    expect(record2['isRemote']).toBe(true);
  });

  it('Scenario 2: parses CSV into rows and maps with example-based schema adapter', () => {
    const rawCsv = `Order ID,Customer,Total Amount,Shipped
ORD-881,Apex Logistics,"2,450.00",TRUE
ORD-882,Beacon Systems,980.50,FALSE`;

    const { headers, rows } = parseCsv(rawCsv);
    expect(headers).toEqual(['Order ID', 'Customer', 'Total Amount', 'Shipped']);
    expect(rows).toHaveLength(2);

    // Derive adapter directly from an example object
    const example = {
      orderId: 'ORD-000',
      customer: 'Example Corp',
      totalAmount: 100.0,
      shipped: true,
    };
    const adapter = exampleJsonAdapter(example, { id: 'orders', version: 1 });

    const plan: MappingPlan = {
      planVersion: 2,
      target: 'orders',
      schemaVersion: 1,
      entries: [
        { column: 0, ref: 'orderId' },
        { column: 1, ref: 'customer' },
        { column: 2, ref: 'totalAmount' },
        { column: 3, ref: 'shipped' },
      ],
    };

    const result = applyMapping(rows, plan, adapter, { headers });
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);

    expect(result.records[0]).toEqual({
      orderId: 'ORD-881',
      customer: 'Apex Logistics',
      totalAmount: 2450.0,
      shipped: true,
    });
    expect(result.records[1]).toEqual({
      orderId: 'ORD-882',
      customer: 'Beacon Systems',
      totalAmount: 980.5,
      shipped: false,
    });
  });

  it('Scenario 3: aggregates multi-row spreadsheet entries into grouped parent records', () => {
    const schema = {
      type: 'object',
      properties: {
        invoiceId: { type: 'string' },
        customer: { type: 'string' },
        lineItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemCode: { type: 'string' },
              qty: { type: 'number' },
            },
          },
        },
      },
      required: ['invoiceId'],
    };
    const adapter = jsonSchemaAdapter(schema);

    const headers = ['Invoice #', 'Client Name', 'Item Code', 'Quantity'];
    // 3 rows representing 2 invoices: INV-01 has 2 items, INV-02 has 1 item
    const rows = [
      ['INV-01', 'Acme Corp', 'WIDGET-A', '5'],
      ['INV-01', 'Acme Corp', 'WIDGET-B', '12'],
      ['INV-02', 'Beta LLC', 'GADGET-Z', '1'],
    ];

    const plan: MappingPlan = {
      planVersion: 2,
      target: adapter.id,
      schemaVersion: adapter.version,
      group: {
        key: [0],
        collect: ['lineItems'],
      },
      entries: [
        { column: 0, ref: 'invoiceId' },
        { column: 1, ref: 'customer' },
        { column: 2, ref: 'lineItems.itemCode' },
        { column: 3, ref: 'lineItems.qty' },
      ],
    };

    const result = applyMapping(rows, plan, adapter, { headers });
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);

    const invoice1 = result.records[0];
    expect(invoice1['invoiceId']).toBe('INV-01');
    expect(invoice1['customer']).toBe('Acme Corp');
    expect(invoice1['lineItems']).toEqual([
      { itemCode: 'WIDGET-A', qty: 5 },
      { itemCode: 'WIDGET-B', qty: 12 },
    ]);

    const invoice2 = result.records[1];
    expect(invoice2['invoiceId']).toBe('INV-02');
    expect(invoice2['customer']).toBe('Beta LLC');
    expect(invoice2['lineItems']).toEqual([
      { itemCode: 'GADGET-Z', qty: 1 },
    ]);
  });

  it('Scenario 4: rejects prototype pollution attempts with PLAN_UNSAFE_PATH', () => {
    const unsafePlan: MappingPlan = {
      planVersion: 2,
      target: 'any',
      schemaVersion: 1,
      entries: [
        { column: 0, ref: '__proto__.isAdmin' },
      ],
    };

    const { problems } = readPlan(unsafePlan);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].code).toBe('PLAN_UNSAFE_PATH');
  });

  describe('Stress Tests: Large Complex Data Mappings', () => {
    it('Stress Test 1: maps 10,000 tabular rows into deeply nested enterprise schemas with split lists and coerced currencies', () => {
      const enterpriseSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'EnterpriseRecord',
        type: 'object',
        properties: {
          org: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              hierarchy: {
                type: 'object',
                properties: {
                  division: {
                    type: 'object',
                    properties: {
                      region: { type: 'string' },
                      costCenter: { type: 'string' },
                    },
                  },
                },
              },
              contact: {
                type: 'object',
                properties: {
                  primaryEmail: { type: 'string', format: 'email' },
                  address: {
                    type: 'object',
                    properties: {
                      postalCode: { type: 'string' },
                      country: { type: 'string' },
                    },
                  },
                },
              },
            },
            required: ['id'],
          },
          metrics: {
            type: 'object',
            properties: {
              annualRecurringRevenue: { type: 'number' },
              headcount: { type: 'number' },
              isActive: { type: 'boolean' },
              launchDate: { type: 'string', format: 'date' },
            },
          },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['org'],
      };

      const adapter = jsonSchemaAdapter(enterpriseSchema);
      const headers = [
        'Org ID',
        'Company Name',
        'Region Code',
        'Cost Center Code',
        'Support Contact Email',
        'Zip/Postal Code',
        'Country Code',
        'Annual ARR',
        'Team Size',
        'Active Account Flag',
        'Contract Start Date',
        'Cloud Capabilities',
        'Metadata Tags',
      ];

      const ROW_COUNT = 10000;
      const rows: string[][] = new Array(ROW_COUNT);

      for (let i = 0; i < ROW_COUNT; i++) {
        const idNum = String(i + 1).padStart(6, '0');
        const revenue = (100000 + (i * 12.5)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const day = String((i % 28) + 1).padStart(2, '0');
        const month = String((i % 12) + 1).padStart(2, '0');

        rows[i] = [
          `ORG-${idNum}`,
          `Enterprise Client ${idNum}`,
          i % 2 === 0 ? 'NA-EAST' : 'EU-CENTRAL',
          `CC-${1000 + (i % 50)}`,
          `admin_${idNum}@clientcorp.com`,
          `ZIP-${10000 + (i % 9000)}`,
          i % 2 === 0 ? 'US' : 'DE',
          revenue,
          String(50 + (i % 500)),
          i % 3 === 0 ? 'true' : 'yes',
          `${day}/${month}/2026`,
          'SSO; RBAC; Audit Logs; High Availability',
          'enterprise, tier-1, strategic, gdpr-compliant',
        ];
      }

      const plan: MappingPlan = {
        planVersion: 2,
        target: adapter.id,
        schemaVersion: adapter.version,
        entries: [
          { column: 0, ref: 'org.id' },
          { column: 1, ref: 'org.name' },
          { column: 2, ref: 'org.hierarchy.division.region' },
          { column: 3, ref: 'org.hierarchy.division.costCenter' },
          { column: 4, ref: 'org.contact.primaryEmail' },
          { column: 5, ref: 'org.contact.address.postalCode' },
          { column: 6, ref: 'org.contact.address.country' },
          { column: 7, ref: 'metrics.annualRecurringRevenue' },
          { column: 8, ref: 'metrics.headcount' },
          { column: 9, ref: 'metrics.isActive' },
          { column: 10, ref: 'metrics.launchDate', dateOrder: 'DMY' },
          { column: 11, ref: 'capabilities', split: ';' },
          { column: 12, ref: 'tags', split: ',' },
        ],
      };

      const { plan: normalizedPlan, problems } = readPlan(plan);
      expect(problems).toEqual([]);
      expect(validatePlan(normalizedPlan!, adapter)).toEqual([]);

      const startTime = Date.now();
      const result = applyMapping(rows, plan, adapter, { headers });
      const durationMs = Date.now() - startTime;

      expect(result.errors).toEqual([]);
      expect(result.records).toHaveLength(ROW_COUNT);
      expect(result.imported).toBe(ROW_COUNT);

      // Spot check first record (index 0)
      const first = result.records[0] as Record<string, any>;
      expect(first['org']['id']).toBe('ORG-000001');
      expect(first['org']['name']).toBe('Enterprise Client 000001');
      expect(first['org']['hierarchy']['division']['region']).toBe('NA-EAST');
      expect(first['org']['contact']['primaryEmail']).toBe('admin_000001@clientcorp.com');
      expect(first['org']['contact']['address']['country']).toBe('US');
      expect(first['metrics']['annualRecurringRevenue']).toBe(100000.0);
      expect(first['metrics']['headcount']).toBe(50);
      expect(first['metrics']['isActive']).toBe(true);
      expect(first['metrics']['launchDate']).toBe('2026-01-01');
      expect(first['capabilities']).toEqual(['SSO', 'RBAC', 'Audit Logs', 'High Availability']);
      expect(first['tags']).toEqual(['enterprise', 'tier-1', 'strategic', 'gdpr-compliant']);

      // Spot check middle record (index 5000)
      const mid = result.records[5000] as Record<string, any>;
      expect(mid['org']['id']).toBe('ORG-005001');
      expect(mid['metrics']['annualRecurringRevenue']).toBe(162500.0);
      expect(mid['metrics']['isActive']).toBe(true);
      expect(mid['tags']).toHaveLength(4);

      // Spot check last record (index 9999)
      const last = result.records[ROW_COUNT - 1] as Record<string, any>;
      expect(last['org']['id']).toBe('ORG-010000');
      expect(last['org']['hierarchy']['division']['region']).toBe('EU-CENTRAL');
      expect(last['metrics']['annualRecurringRevenue']).toBe(224987.5);

      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it('Stress Test 2: aggregates 6,000 multi-row spreadsheet entries into 1,000 grouped parent records with child items', () => {
      const orderSchema = {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          customer: {
            type: 'object',
            properties: {
              accountNumber: { type: 'string' },
              name: { type: 'string' },
            },
          },
          orderDate: { type: 'string', format: 'date' },
          lineItems: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string' },
                description: { type: 'string' },
                quantity: { type: 'number' },
                unitPrice: { type: 'number' },
              },
            },
          },
        },
        required: ['orderId'],
      };

      const adapter = jsonSchemaAdapter(orderSchema);
      const headers = [
        'Order Number',
        'Customer Account',
        'Customer Name',
        'Order Date',
        'SKU Code',
        'Item Description',
        'Qty',
        'Price',
      ];

      const ORDER_COUNT = 1000;
      const ITEMS_PER_ORDER = 6;
      const TOTAL_ROWS = ORDER_COUNT * ITEMS_PER_ORDER;
      const rows: string[][] = new Array(TOTAL_ROWS);

      let rowIndex = 0;
      for (let ord = 0; ord < ORDER_COUNT; ord++) {
        const orderId = `ORD-${String(ord + 1).padStart(5, '0')}`;
        const custAcc = `ACC-${String(100 + (ord % 50)).padStart(4, '0')}`;
        const custName = `Global Buyer ${ord + 1}`;
        const orderDate = `15/10/2026`;

        for (let item = 0; item < ITEMS_PER_ORDER; item++) {
          rows[rowIndex++] = [
            orderId,
            custAcc,
            custName,
            orderDate,
            `SKU-${item + 101}`,
            `Industrial Component ${item + 1}`,
            String((item + 1) * 5),
            (25.5 * (item + 1)).toFixed(2),
          ];
        }
      }

      const plan: MappingPlan = {
        planVersion: 2,
        target: adapter.id,
        schemaVersion: adapter.version,
        group: {
          key: [0],
          collect: ['lineItems'],
        },
        entries: [
          { column: 0, ref: 'orderId' },
          { column: 1, ref: 'customer.accountNumber' },
          { column: 2, ref: 'customer.name' },
          { column: 3, ref: 'orderDate', dateOrder: 'DMY' },
          { column: 4, ref: 'lineItems.sku' },
          { column: 5, ref: 'lineItems.description' },
          { column: 6, ref: 'lineItems.quantity' },
          { column: 7, ref: 'lineItems.unitPrice' },
        ],
      };

      const startTime = Date.now();
      const result = applyMapping(rows, plan, adapter, { headers });
      const durationMs = Date.now() - startTime;

      expect(result.errors).toEqual([]);
      expect(result.records).toHaveLength(ORDER_COUNT);
      expect(result.rowsInImported).toBe(TOTAL_ROWS);
      expect(result.imported).toBe(ORDER_COUNT);

      // Spot check first grouped order
      const firstOrder = result.records[0] as Record<string, any>;
      expect(firstOrder['orderId']).toBe('ORD-00001');
      expect(firstOrder['customer']).toEqual({
        accountNumber: 'ACC-0100',
        name: 'Global Buyer 1',
      });
      expect(firstOrder['orderDate']).toBe('2026-10-15');
      expect(firstOrder['lineItems']).toHaveLength(ITEMS_PER_ORDER);
      expect(firstOrder['lineItems'][0]).toEqual({
        sku: 'SKU-101',
        description: 'Industrial Component 1',
        quantity: 5,
        unitPrice: 25.5,
      });
      expect(firstOrder['lineItems'][5]).toEqual({
        sku: 'SKU-106',
        description: 'Industrial Component 6',
        quantity: 30,
        unitPrice: 153.0,
      });

      // Spot check last grouped order
      const lastOrder = result.records[ORDER_COUNT - 1] as Record<string, any>;
      expect(lastOrder['orderId']).toBe('ORD-01000');
      expect(lastOrder['lineItems']).toHaveLength(ITEMS_PER_ORDER);

      expect(durationMs).toBeGreaterThanOrEqual(0);
    });

    it('Stress Test 3: parses and maps a high-volume CSV payload with embedded quotes and complex formatting', () => {
      const CSV_ROWS = 5000;
      const csvLines: string[] = ['Transaction ID,Entity Name,Amount,Category,Settled'];

      for (let i = 0; i < CSV_ROWS; i++) {
        const txId = `TX-${String(i + 1).padStart(6, '0')}`;
        // Add embedded commas inside quoted text
        const entityName = `"Organization, Division ${i + 1} & Partners"`;
        const amount = `"${(500 + (i * 3.75)).toLocaleString('en-US', { minimumFractionDigits: 2 })}"`;
        const category = i % 2 === 0 ? 'Consulting Services' : 'Software Licensing';
        const settled = i % 4 === 0 ? 'FALSE' : 'TRUE';
        csvLines.push(`${txId},${entityName},${amount},${category},${settled}`);
      }

      const rawCsv = csvLines.join('\n');

      const parseStart = Date.now();
      const { headers, rows } = parseCsv(rawCsv);
      const parseDurationMs = Date.now() - parseStart;

      expect(headers).toEqual(['Transaction ID', 'Entity Name', 'Amount', 'Category', 'Settled']);
      expect(rows).toHaveLength(CSV_ROWS);
      expect(parseDurationMs).toBeGreaterThanOrEqual(0);

      const exampleRecord = {
        txId: 'TX-000000',
        entityName: 'Example Org',
        amount: 100.0,
        category: 'Services',
        settled: true,
      };

      const adapter = exampleJsonAdapter(exampleRecord, { id: 'transactions', version: 1 });
      const plan: MappingPlan = {
        planVersion: 2,
        target: 'transactions',
        schemaVersion: 1,
        entries: [
          { column: 0, ref: 'txId' },
          { column: 1, ref: 'entityName' },
          { column: 2, ref: 'amount' },
          { column: 3, ref: 'category' },
          { column: 4, ref: 'settled' },
        ],
      };

      const mapStart = Date.now();
      const result = applyMapping(rows, plan, adapter, { headers });
      const mapDurationMs = Date.now() - mapStart;

      expect(result.errors).toEqual([]);
      expect(result.records).toHaveLength(CSV_ROWS);

      // Verify that quoted comma string was preserved correctly
      const firstRecord = result.records[0] as Record<string, any>;
      expect(firstRecord['txId']).toBe('TX-000001');
      expect(firstRecord['entityName']).toBe('Organization, Division 1 & Partners');
      expect(firstRecord['amount']).toBe(500.0);
      expect(firstRecord['settled']).toBe(false);

      const midRecord = result.records[2500] as Record<string, any>;
      expect(midRecord['txId']).toBe('TX-002501');
      expect(midRecord['entityName']).toBe('Organization, Division 2501 & Partners');
      // 2500 % 4 === 0 -> FALSE -> false
      expect(midRecord['settled']).toBe(false);

      const record2501 = result.records[2501] as Record<string, any>;
      // 2501 % 4 === 1 -> TRUE -> true
      expect(record2501['settled']).toBe(true);

      expect(mapDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Hardcore Scale & Complexity Stress Tests: 10k & 20k Records', () => {
    it('Hardcore 10k: maps 10,000 records with 5-level deep object nesting, scientific notation exponents, leap-year dates, and multi-separator split lists', () => {
      const infrastructureSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'CloudInfrastructureNode',
        type: 'object',
        properties: {
          nodeId: { type: 'string' },
          cluster: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              topology: {
                type: 'object',
                properties: {
                  region: { type: 'string' },
                  datacenter: {
                    type: 'object',
                    properties: {
                      zone: { type: 'string' },
                      rack: {
                        type: 'object',
                        properties: {
                          unit: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
            required: ['name'],
          },
          telemetry: {
            type: 'object',
            properties: {
              cpuUtilizationPercent: { type: 'number' },
              memoryBytes: { type: 'number' },
              errorRateExponent: { type: 'number' },
              isHealthy: { type: 'boolean' },
              provisionedDate: { type: 'string', format: 'date' },
            },
          },
          networking: {
            type: 'object',
            properties: {
              supportedProtocols: {
                type: 'array',
                items: { type: 'string' },
              },
              ipSubnets: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
          operationalState: { type: 'string' },
        },
        required: ['nodeId'],
      };

      const adapter = jsonSchemaAdapter(infrastructureSchema);
      const headers = [
        'Node Identifier',
        'Cluster Name',
        'Region Code',
        'Availability Zone',
        'Rack Unit Position',
        'CPU Utilization %',
        'Total RAM (Bytes)',
        'Error Rate (Sci)',
        'Node Health Status',
        'Provisioned Date (DD/MM/YYYY)',
        'Supported Network Protocols',
        'Assigned CIDR Subnets',
        'State',
      ];

      const COUNT = 10000;
      const rows: string[][] = new Array(COUNT);

      for (let i = 0; i < COUNT; i++) {
        const idStr = String(i + 1).padStart(6, '0');
        rows[i] = [
          `NODE-${idStr}`,
          `K8S-CLUSTER-${100 + (i % 25)}`,
          i % 2 === 0 ? 'us-east-1' : 'eu-west-1',
          i % 2 === 0 ? 'us-east-1a' : 'eu-west-1b',
          `RACK-${10 + (i % 40)}-U${(i % 42) + 1}`,
          (35.5 + ((i % 500) * 0.1)).toFixed(2),
          '68,719,476,736',
          '1.25e-4',
          i % 5 === 0 ? '1' : 'true',
          '28/02/2024', // Valid leap-year date
          'TCP; UDP; HTTP/3; gRPC; QUIC',
          '10.240.0.0/16, 172.16.4.0/24, 192.168.1.0/24',
          'ACTIVE',
        ];
      }

      const plan: MappingPlan = {
        planVersion: 2,
        target: adapter.id,
        schemaVersion: adapter.version,
        entries: [
          { column: 0, ref: 'nodeId' },
          { column: 1, ref: 'cluster.name' },
          { column: 2, ref: 'cluster.topology.region' },
          { column: 3, ref: 'cluster.topology.datacenter.zone' },
          { column: 4, ref: 'cluster.topology.datacenter.rack.unit' },
          { column: 5, ref: 'telemetry.cpuUtilizationPercent' },
          { column: 6, ref: 'telemetry.memoryBytes' },
          { column: 7, ref: 'telemetry.errorRateExponent' },
          { column: 8, ref: 'telemetry.isHealthy' },
          { column: 9, ref: 'telemetry.provisionedDate', dateOrder: 'DMY' },
          { column: 10, ref: 'networking.supportedProtocols', split: ';' },
          { column: 11, ref: 'networking.ipSubnets', split: ',' },
          { column: 12, ref: 'operationalState' },
        ],
      };

      const { plan: normalizedPlan, problems } = readPlan(plan);
      expect(problems).toEqual([]);
      expect(validatePlan(normalizedPlan!, adapter)).toEqual([]);

      const startTime = Date.now();
      const result = applyMapping(rows, plan, adapter, { headers });
      const durationMs = Date.now() - startTime;

      expect(result.errors).toEqual([]);
      expect(result.records).toHaveLength(COUNT);
      expect(result.imported).toBe(COUNT);

      // Deep spot check at 0% (index 0)
      const first = result.records[0] as Record<string, any>;
      expect(first['nodeId']).toBe('NODE-000001');
      expect(first['cluster']['name']).toBe('K8S-CLUSTER-100');
      expect(first['cluster']['topology']['datacenter']['rack']['unit']).toBe('RACK-10-U1');
      expect(first['telemetry']['memoryBytes']).toBe(68719476736);
      expect(first['telemetry']['errorRateExponent']).toBe(0.000125);
      expect(first['telemetry']['isHealthy']).toBe(true);
      expect(first['telemetry']['provisionedDate']).toBe('2024-02-28');
      expect(first['networking']['supportedProtocols']).toEqual(['TCP', 'UDP', 'HTTP/3', 'gRPC', 'QUIC']);
      expect(first['networking']['ipSubnets']).toEqual(['10.240.0.0/16', '172.16.4.0/24', '192.168.1.0/24']);
      expect(first['operationalState']).toBe('ACTIVE');

      // Deep spot check at 50% (index 5000)
      const mid = result.records[5000] as Record<string, any>;
      expect(mid['nodeId']).toBe('NODE-005001');
      expect(mid['cluster']['topology']['region']).toBe('us-east-1');
      expect(mid['telemetry']['isHealthy']).toBe(true);
      expect(mid['telemetry']['errorRateExponent']).toBe(0.000125);

      // Deep spot check at 100% (index 9999)
      const last = result.records[COUNT - 1] as Record<string, any>;
      expect(last['nodeId']).toBe('NODE-010000');
      expect(last['cluster']['topology']['region']).toBe('eu-west-1');
      expect(last['telemetry']['memoryBytes']).toBe(68719476736);

      expect(durationMs).toBeGreaterThanOrEqual(0);
    }, 45000);

    it('Hardcore 20k: streams and maps 20,000 tabular rows across multi-level commercial finance schemas', () => {
      const financeSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'GlobalCommerceTransaction',
        type: 'object',
        properties: {
          transactionId: { type: 'string' },
          merchant: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              profile: {
                type: 'object',
                properties: {
                  legalName: { type: 'string' },
                  countryCode: { type: 'string' },
                  category: {
                    type: 'object',
                    properties: {
                      mcc: { type: 'string' },
                      riskTier: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          accounting: {
            type: 'object',
            properties: {
              grossAmount: { type: 'number' },
              feeDeducted: { type: 'number' },
              netPayout: { type: 'number' },
              feePercentage: { type: 'number' },
              isReconciled: { type: 'boolean' },
              settlementDate: { type: 'string', format: 'date' },
            },
          },
          auditTags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['transactionId'],
      };

      const adapter = jsonSchemaAdapter(financeSchema);
      const headers = [
        'Transaction Ref',
        'Merchant ID',
        'Merchant Legal Name',
        'Country Code',
        'MCC Code',
        'Risk Tier Code',
        'Gross Amount (USD)',
        'Processing Fee',
        'Net Payout',
        'Fee Ratio',
        'Reconciled Flag',
        'Settlement Date',
        'Audit Tags',
      ];

      const COUNT = 20000;
      const rows: string[][] = new Array(COUNT);

      for (let i = 0; i < COUNT; i++) {
        const idStr = String(i + 1).padStart(7, '0');
        const gross = (5000 + (i * 0.75)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fee = ((5000 + (i * 0.75)) * 0.029).toFixed(2);
        const net = ((5000 + (i * 0.75)) * 0.971).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const day = String((i % 28) + 1).padStart(2, '0');
        const month = String((i % 12) + 1).padStart(2, '0');

        rows[i] = [
          `TXN-${idStr}`,
          `MCH-${1000 + (i % 200)}`,
          `Merchant Commercial Entity ${1000 + (i % 200)}`,
          i % 2 === 0 ? 'US' : 'GB',
          `MCC-5411`,
          i % 3 === 0 ? 'TIER-A' : 'TIER-B',
          gross,
          fee,
          net,
          '0.029',
          i % 2 === 0 ? 'true' : 'yes',
          `${day}/${month}/2026`,
          'automated-payout, card-present, authorized',
        ];
      }

      const plan: MappingPlan = {
        planVersion: 2,
        target: adapter.id,
        schemaVersion: adapter.version,
        entries: [
          { column: 0, ref: 'transactionId' },
          { column: 1, ref: 'merchant.id' },
          { column: 2, ref: 'merchant.profile.legalName' },
          { column: 3, ref: 'merchant.profile.countryCode' },
          { column: 4, ref: 'merchant.profile.category.mcc' },
          { column: 5, ref: 'merchant.profile.category.riskTier' },
          { column: 6, ref: 'accounting.grossAmount' },
          { column: 7, ref: 'accounting.feeDeducted' },
          { column: 8, ref: 'accounting.netPayout' },
          { column: 9, ref: 'accounting.feePercentage' },
          { column: 10, ref: 'accounting.isReconciled' },
          { column: 11, ref: 'accounting.settlementDate', dateOrder: 'DMY' },
          { column: 12, ref: 'auditTags', split: ',' },
        ],
      };

      const startTime = Date.now();
      const result = applyMapping(rows, plan, adapter, { headers });
      const durationMs = Date.now() - startTime;

      expect(result.errors).toEqual([]);
      expect(result.records).toHaveLength(COUNT);
      expect(result.imported).toBe(COUNT);
      expect(result.rowsInImported).toBe(COUNT);

      // Spot check at 0%
      const first = result.records[0] as Record<string, any>;
      expect(first['transactionId']).toBe('TXN-0000001');
      expect(first['merchant']['profile']['legalName']).toBe('Merchant Commercial Entity 1000');
      expect(first['merchant']['profile']['category']['mcc']).toBe('MCC-5411');
      expect(first['accounting']['grossAmount']).toBe(5000.0);
      expect(first['accounting']['feeDeducted']).toBe(145.0);
      expect(first['accounting']['feePercentage']).toBe(0.029);
      expect(first['accounting']['isReconciled']).toBe(true);
      expect(first['accounting']['settlementDate']).toBe('2026-01-01');
      expect(first['auditTags']).toEqual(['automated-payout', 'card-present', 'authorized']);

      // Spot check at 50% (index 10000)
      const mid = result.records[10000] as Record<string, any>;
      expect(mid['transactionId']).toBe('TXN-0010001');
      expect(mid['accounting']['grossAmount']).toBe(12500.0);
      expect(mid['accounting']['feePercentage']).toBe(0.029);
      expect(mid['auditTags']).toHaveLength(3);

      // Spot check at 100% (index 19999)
      const last = result.records[COUNT - 1] as Record<string, any>;
      expect(last['transactionId']).toBe('TXN-0020000');
      expect(last['merchant']['profile']['countryCode']).toBe('GB');

      expect(durationMs).toBeGreaterThanOrEqual(0);
    }, 45000);

    it('Hardcore 20k Grouping: aggregates 20,000 spreadsheet rows into 4,000 hierarchical parent orders with 5 child line items each', () => {
      const parentOrderSchema = {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          customer: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              name: { type: 'string' },
            },
          },
          orderDate: { type: 'string', format: 'date' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string' },
                description: { type: 'string' },
                quantity: { type: 'number' },
                unitPrice: { type: 'number' },
              },
            },
          },
        },
        required: ['orderId'],
      };

      const adapter = jsonSchemaAdapter(parentOrderSchema);
      const headers = [
        'Order ID',
        'Customer Code',
        'Customer Name',
        'Order Date',
        'SKU',
        'Description',
        'Quantity',
        'Unit Price',
      ];

      const ORDER_COUNT = 4000;
      const ITEMS_PER_ORDER = 5;
      const TOTAL_ROWS = ORDER_COUNT * ITEMS_PER_ORDER; // 20,000 rows!
      const rows: string[][] = new Array(TOTAL_ROWS);

      let rowIndex = 0;
      for (let ord = 0; ord < ORDER_COUNT; ord++) {
        const orderId = `PO-${String(ord + 1).padStart(6, '0')}`;
        const custCode = `CUST-${100 + (ord % 100)}`;
        const custName = `Enterprise Client ${ord + 1}`;
        const date = '12/10/2026';

        for (let item = 0; item < ITEMS_PER_ORDER; item++) {
          rows[rowIndex++] = [
            orderId,
            custCode,
            custName,
            date,
            `SKU-ITM-${1000 + item}`,
            `Enterprise Hardware Component ${item + 1}`,
            String((item + 1) * 10),
            (45.5 * (item + 1)).toFixed(2),
          ];
        }
      }

      const plan: MappingPlan = {
        planVersion: 2,
        target: adapter.id,
        schemaVersion: adapter.version,
        group: {
          key: [0],
          collect: ['items'],
        },
        entries: [
          { column: 0, ref: 'orderId' },
          { column: 1, ref: 'customer.code' },
          { column: 2, ref: 'customer.name' },
          { column: 3, ref: 'orderDate', dateOrder: 'DMY' },
          { column: 4, ref: 'items.sku' },
          { column: 5, ref: 'items.description' },
          { column: 6, ref: 'items.quantity' },
          { column: 7, ref: 'items.unitPrice' },
        ],
      };

      const startTime = Date.now();
      const result = applyMapping(rows, plan, adapter, { headers });
      const durationMs = Date.now() - startTime;

      expect(result.errors).toEqual([]);
      expect(result.records).toHaveLength(ORDER_COUNT);
      expect(result.imported).toBe(ORDER_COUNT);
      expect(result.rowsInImported).toBe(TOTAL_ROWS);

      // Spot check first grouped parent record
      const firstOrder = result.records[0] as Record<string, any>;
      expect(firstOrder['orderId']).toBe('PO-000001');
      expect(firstOrder['customer']).toEqual({
        code: 'CUST-100',
        name: 'Enterprise Client 1',
      });
      expect(firstOrder['orderDate']).toBe('2026-10-12');
      expect(firstOrder['items']).toHaveLength(ITEMS_PER_ORDER);
      expect(firstOrder['items'][0]).toEqual({
        sku: 'SKU-ITM-1000',
        description: 'Enterprise Hardware Component 1',
        quantity: 10,
        unitPrice: 45.5,
      });
      expect(firstOrder['items'][4]).toEqual({
        sku: 'SKU-ITM-1004',
        description: 'Enterprise Hardware Component 5',
        quantity: 50,
        unitPrice: 227.5,
      });

      // Spot check middle grouped parent record (index 2000)
      const midOrder = result.records[2000] as Record<string, any>;
      expect(midOrder['orderId']).toBe('PO-002001');
      expect(midOrder['items']).toHaveLength(ITEMS_PER_ORDER);

      // Spot check last grouped parent record (index 3999)
      const lastOrder = result.records[ORDER_COUNT - 1] as Record<string, any>;
      expect(lastOrder['orderId']).toBe('PO-004000');
      expect(lastOrder['items']).toHaveLength(ITEMS_PER_ORDER);

      expect(durationMs).toBeGreaterThanOrEqual(0);
    }, 45000);
  });
});


