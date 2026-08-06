import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { EntityRefFieldComponent } from './entity-ref-field.component';
import { EntityRefRegistryService } from '../services/entity-ref-registry.service';

describe('EntityRefFieldComponent', () => {
  let component: EntityRefFieldComponent;
  let fixture: ComponentFixture<EntityRefFieldComponent>;
  let mockRegistry: any;

  beforeEach(async () => {
    mockRegistry = {
      resolve: jest.fn().mockReturnValue(() => Promise.resolve([{ value: '1', label: 'Item 1' }]))
    };

    await TestBed.configureTestingModule({
      imports: [EntityRefFieldComponent, ReactiveFormsModule],
      providers: [
        { provide: EntityRefRegistryService, useValue: mockRegistry }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(EntityRefFieldComponent);
    component = fixture.componentInstance;
    component.field = { id: 'ref', label: { en: 'Ref' } } as any;
    component.control = new FormControl('');
    fixture.detectChanges();
  });

  it('should load options from registry on init', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    expect(mockRegistry.resolve).toHaveBeenCalledWith('ref');
    expect(component.options().length).toBe(1);
    expect(component.options()[0].label).toBe('Item 1');
  });

  it('should show loading state', async () => {
    component.loading.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Loading...');
  });
});
