/**
 * Vendor Integrations Module
 * 
 * Central export for all vendor integration functionality.
 */

// Types
export * from './types';
export * from './VendorAdapter';

// Registry
export * from './registry';

// Adapters
export { SyscoAdapter } from './adapters/sysco.adapter';
export { GfsAdapter } from './adapters/gfs.adapter';
export { UsFoodsAdapter } from './adapters/usfoods.adapter';

// Utilities
export { GenericEdiGateway } from './edi/GenericEdiGateway';
export { CsvOrderGuide } from './csv/CsvOrderGuide';
export { CxmlClient, createCxmlClient } from './punchout/CxmlClient';
