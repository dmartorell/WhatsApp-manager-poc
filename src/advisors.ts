import { config } from './config.js';

export interface Advisor {
  category: string;
  description: string;
  name: string;
  email: string;
}

export interface AdvisorsConfig {
  advisors: Advisor[];
  fallback: { name: string; email: string };
}

const baseEmail = config.baseEmail;

export const advisorsConfig: AdvisorsConfig = {
  advisors: [
    {
      category: 'fiscal',
      description: 'Impuestos, IVA, IRPF, declaraciones, modelos tributarios',
      name: 'Asesor Fiscal (demo)',
      email: `${baseEmail}+fiscal@gmail.com`,
    },
    {
      category: 'laboral',
      description: 'Nóminas, contratos, Seguridad Social, bajas, altas',
      name: 'Asesor Laboral (demo)',
      email: `${baseEmail}+laboral@gmail.com`,
    },
    {
      category: 'contabilidad',
      description: 'Facturas, balances, cuentas anuales, asientos',
      name: 'Asesor Contable (demo)',
      email: `${baseEmail}+contabilidad@gmail.com`,
    },
  ],
  fallback: {
    name: 'Recepción (demo)',
    email: `${baseEmail}+recepcion@gmail.com`,
  },
};
