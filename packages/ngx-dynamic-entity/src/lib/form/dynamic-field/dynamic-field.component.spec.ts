import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { DynamicFieldComponent } from './dynamic-field.component';
import { FieldRegistryService } from '../../services/field-registry.service';
import { RbacService } from '../../services/rbac.service';
import { Component, Input } from '@angular/core';

@Component({ selector: 'mock-text', template: '' })
class MockTextField {
  @Input() field: any;
  @Input() control: any;
  @Input() language: any;
  @Input() readonly: any;
  @Input() masked: any;
}

describe('DynamicFieldComponent', () => {
  let component: DynamicFieldComponent;
  let fixture: ComponentFixture<DynamicFieldComponent>;
  let mockFieldRegistry: any;
  let mockRbacService: any;

  beforeEach(async () => {
    mockFieldRegistry = { resolve: jest.fn().mockReturnValue(MockTextField) };
    mockRbacService = { shouldMaskField: jest.fn().mockReturnValue(false) };

    await TestBed.configureTestingModule({
      imports: [DynamicFieldComponent],
      providers: [
        { provide: FieldRegistryService, useValue: mockFieldRegistry },
        { provide: RbacService, useValue: mockRbacService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DynamicFieldComponent);
    component = fixture.componentInstance;
    component.field = { type: 'text', id: 'name' } as any;
    component.control = new FormControl('');
    component.config = { version: 1 } as any;
    fixture.detectChanges();
  });

  it('should resolve and create component class', () => {
    expect(mockFieldRegistry.resolve).toHaveBeenCalledWith('text');
  });

  it('should pass inputs to mounted component', () => {
    const instance = (component as any).mountedComponent;
    expect(instance.field).toBe(component.field);
    expect(instance.control).toBe(component.control);
  });

  it('should determine masking via RbacService', () => {
    mockRbacService.shouldMaskField.mockReturnValue(true);
    component.ngOnChanges({});
    const instance = (component as any).mountedComponent;
    expect(instance.masked).toBeTrue();
  });
});
