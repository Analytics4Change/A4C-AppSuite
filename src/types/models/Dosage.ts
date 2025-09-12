// Dosage Forms (broad categories like Solid, Liquid, etc.)
export type DosageForm = 
  | 'Solid'
  | 'Liquid'
  | 'Topical/Local'
  | 'Inhalation'
  | 'Injectable'
  | 'Rectal/Vaginal'
  | 'Ophthalmic/Otic'
  | 'Miscellaneous';

// Solid Dosage Forms
export type SolidDosageForm = 
  | 'Tablet'
  | 'Caplet'
  | 'Capsule'
  | 'Chewable Tablet'
  | 'Orally Disintegrating Tablet (ODT)'
  | 'Sublingual Tablet (SL)'
  | 'Buccal Tablet';

// Liquid Dosage Forms
export type LiquidDosageForm = 
  | 'Solution'
  | 'Suspension'
  | 'Syrup'
  | 'Elixir'
  | 'Concentrate';

// Topical and Local Application Forms
export type TopicalDosageForm = 
  | 'Cream'
  | 'Ointment'
  | 'Gel'
  | 'Lotion'
  | 'Patch (Transdermal)'
  | 'Foam';

// Inhalation and Respiratory Forms
export type InhalationDosageForm = 
  | 'Inhaler (MDI or DPI)'
  | 'Nebulizer Solution'
  | 'Nasal Spray';

// Injectable Forms
export type InjectableDosageForm = 
  | 'Injection (IV, IM, SubQ)'
  | 'Prefilled Syringe';

// Rectal and Vaginal Forms
export type RectalVaginalDosageForm = 
  | 'Suppository'
  | 'Enema'
  | 'Vaginal Cream or Tablet';

// Ophthalmic and Otic Forms
export type OphthalmicOticDosageForm = 
  | 'Eye Drops / Ear Drops'
  | 'Ophthalmic Ointment';

// Miscellaneous Forms
export type MiscellaneousDosageForm = 
  | 'Lozenge / Troche'
  | 'Powder'
  | 'Spray'
  | 'Implant'
  | 'Lollipop (medicated)';

// Union type for all specific dosage routes
export type DosageRoute = 
  | SolidDosageForm
  | LiquidDosageForm
  | TopicalDosageForm
  | InhalationDosageForm
  | InjectableDosageForm
  | RectalVaginalDosageForm
  | OphthalmicOticDosageForm
  | MiscellaneousDosageForm;

// Dosage Units
export type DosageUnit = 
  // Weight units
  | 'mg'
  | 'mcg'
  | 'g'
  // Volume units
  | 'mL'
  | 'L'
  | 'tsp'
  | 'tbsp'
  // Concentration units
  | 'mg/mL'
  | 'mcg/mL'
  // Rate units
  | 'mcg/hr'
  | 'mg/day'
  | 'mcg/puff'
  | 'mg/puff'
  | 'mcg/spray'
  // Count units
  | 'tablet(s)'
  | 'scored tablet(s)'
  | 'caplet(s)'
  | 'capsule(s)'
  | 'chewable tablet(s)'
  | 'ODT(s)'
  | 'SL tablet(s)'
  | 'buccal tablet(s)'
  | 'puff(s)'
  | 'inhalation(s)'
  | 'spray(s)'
  | 'drop(s)'
  | 'application(s)'
  | 'patch(es)'
  | 'vial(s)'
  | 'ampule(s)'
  | 'syringe(s)'
  | 'bottle(s)'
  | 'unit(s)'
  | 'suppository(ies)'
  | 'enema(s)'
  | 'insert(s)'
  | 'lozenge(s)'
  | 'troche(s)'
  | 'scoop(s)'
  | 'implant(s)'
  | 'rod(s)'
  | 'lollipop(s)'
  // Percentage
  | '%';

export type DosageFrequency = 
  | 'Once daily'
  | 'Twice daily'
  | 'Three times daily'
  | 'Four times daily'
  | 'Every 4 hours'
  | 'Every 6 hours'
  | 'Every 8 hours'
  | 'Every 12 hours'
  | 'As needed';

// Hierarchical structure for dosage forms
export interface DosageFormHierarchy {
  type: DosageFormType;
  routes: DosageRouteOption[];
}

export interface DosageRouteOption {
  name: DosageRoute;
  units: DosageUnit[];
}

export interface DosageFormMap {
  [key: string]: DosageRouteOption[];
}

// Legacy support
export interface DosageFormUnits {
  [key: string]: DosageUnit[];
}