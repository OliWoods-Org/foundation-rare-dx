/**
 * GenomicInterpreter — Variant classification and interpretation engine
 *
 * ACMG/AMP criteria-based variant pathogenicity assessment,
 * population frequency analysis, and clinical significance determination
 * for WES/WGS rare disease diagnostics.
 */

import { z } from 'zod';

// ─── Schemas ───────────────────────────────────────────────────────────────────

export const GeneticVariantSchema = z.object({
  chromosome: z.string(),
  position: z.number().int().positive(),
  referenceAllele: z.string().regex(/^[ACGT]+$/),
  alternateAllele: z.string().regex(/^[ACGT]+$/),
  gene: z.string(),
  transcript: z.string().optional(),
  hgvsCoding: z.string().optional(),
  hgvsProtein: z.string().optional(),
  consequence: z.enum([
    'missense', 'nonsense', 'frameshift', 'splice_site', 'splice_region',
    'synonymous', 'intronic', 'intergenic', 'start_loss', 'stop_loss',
    'inframe_insertion', 'inframe_deletion', 'utr_5', 'utr_3',
  ]),
  zygosity: z.enum(['heterozygous', 'homozygous', 'hemizygous', 'compound_het']),
  qualityScore: z.number().min(0).optional(),
  readDepth: z.number().int().nonnegative().optional(),
  alleleFrequency: z.number().min(0).max(1).optional(),
});

export const PopulationFrequencySchema = z.object({
  gnomadAll: z.number().min(0).max(1).nullable(),
  gnomadAfr: z.number().min(0).max(1).nullable(),
  gnomadAmr: z.number().min(0).max(1).nullable(),
  gnomadEas: z.number().min(0).max(1).nullable(),
  gnomadNfe: z.number().min(0).max(1).nullable(),
  gnomadSas: z.number().min(0).max(1).nullable(),
  clinvarSignificance: z.enum([
    'pathogenic', 'likely_pathogenic', 'uncertain_significance',
    'likely_benign', 'benign', 'conflicting', 'not_reported',
  ]).nullable(),
  clinvarReviewStars: z.number().int().min(0).max(4).nullable(),
});

export const ACMGCriteriaSchema = z.object({
  pathogenic: z.array(z.object({
    code: z.enum([
      'PVS1', 'PS1', 'PS2', 'PS3', 'PS4',
      'PM1', 'PM2', 'PM3', 'PM4', 'PM5', 'PM6',
      'PP1', 'PP2', 'PP3', 'PP4', 'PP5',
    ]),
    strength: z.enum(['very_strong', 'strong', 'moderate', 'supporting']),
    evidence: z.string(),
  })),
  benign: z.array(z.object({
    code: z.enum([
      'BA1', 'BS1', 'BS2', 'BS3', 'BS4',
      'BP1', 'BP2', 'BP3', 'BP4', 'BP5', 'BP6', 'BP7',
    ]),
    strength: z.enum(['standalone', 'strong', 'supporting']),
    evidence: z.string(),
  })),
});

export const VariantClassificationSchema = z.object({
  variant: GeneticVariantSchema,
  populationFrequency: PopulationFrequencySchema,
  acmgCriteria: ACMGCriteriaSchema,
  classification: z.enum([
    'pathogenic', 'likely_pathogenic', 'uncertain_significance',
    'likely_benign', 'benign',
  ]),
  classificationScore: z.number(),
  inSilicoPredictions: z.object({
    sift: z.enum(['deleterious', 'tolerated']).nullable(),
    polyphen2: z.enum(['probably_damaging', 'possibly_damaging', 'benign']).nullable(),
    cadd: z.number().nullable(),
    revel: z.number().nullable(),
    spliceAI: z.number().nullable(),
  }),
  diseaseAssociations: z.array(z.object({
    diseaseId: z.string(),
    diseaseName: z.string(),
    inheritance: z.string(),
    source: z.enum(['ClinVar', 'OMIM', 'HGMD', 'Literature']),
  })),
  reportNarrative: z.string(),
});

// ─── Types ─────────────────────────────────────────────────────────────────────

export type GeneticVariant = z.infer<typeof GeneticVariantSchema>;
export type PopulationFrequency = z.infer<typeof PopulationFrequencySchema>;
export type ACMGCriteria = z.infer<typeof ACMGCriteriaSchema>;
export type VariantClassification = z.infer<typeof VariantClassificationSchema>;

// ─── Implementation ────────────────────────────────────────────────────────────

/**
 * Determine if a variant is rare enough to be disease-causing
 * Threshold: <0.01% in gnomAD for dominant, <1% for recessive
 */
export function isRareVariant(
  freq: PopulationFrequency,
  inheritance: 'dominant' | 'recessive'
): boolean {
  const threshold = inheritance === 'dominant' ? 0.0001 : 0.01;
  const maxFreq = Math.max(
    freq.gnomadAll ?? 0,
    freq.gnomadAfr ?? 0,
    freq.gnomadAmr ?? 0,
    freq.gnomadEas ?? 0,
    freq.gnomadNfe ?? 0,
    freq.gnomadSas ?? 0,
  );
  return maxFreq < threshold;
}

/**
 * Apply ACMG/AMP classification criteria to a variant
 */
export function applyACMGCriteria(
  variant: GeneticVariant,
  freq: PopulationFrequency,
  predictions: VariantClassification['inSilicoPredictions']
): ACMGCriteria {
  const pathogenic: ACMGCriteria['pathogenic'] = [];
  const benign: ACMGCriteria['benign'] = [];

  // PVS1: Null variant in gene where LOF is a known mechanism
  const nullVariants = ['nonsense', 'frameshift', 'splice_site', 'start_loss'];
  if (nullVariants.includes(variant.consequence)) {
    pathogenic.push({
      code: 'PVS1',
      strength: 'very_strong',
      evidence: `${variant.consequence} variant — predicted loss of function`,
    });
  }

  // PM2: Absent from controls (or at extremely low frequency)
  const maxFreq = Math.max(
    freq.gnomadAll ?? 0, freq.gnomadAfr ?? 0, freq.gnomadAmr ?? 0,
    freq.gnomadEas ?? 0, freq.gnomadNfe ?? 0, freq.gnomadSas ?? 0,
  );
  if (maxFreq === 0) {
    pathogenic.push({
      code: 'PM2',
      strength: 'moderate',
      evidence: 'Absent from gnomAD population database',
    });
  } else if (maxFreq < 0.0001) {
    pathogenic.push({
      code: 'PM2',
      strength: 'supporting' as any, // Downgraded per ClinGen
      evidence: `Very rare in gnomAD (max AF: ${maxFreq.toExponential(2)})`,
    });
  }

  // PP3: Multiple in-silico predictions support deleterious effect
  let deleteriousCount = 0;
  if (predictions.sift === 'deleterious') deleteriousCount++;
  if (predictions.polyphen2 === 'probably_damaging') deleteriousCount++;
  if (predictions.cadd !== null && predictions.cadd > 25) deleteriousCount++;
  if (predictions.revel !== null && predictions.revel > 0.7) deleteriousCount++;

  if (deleteriousCount >= 3) {
    pathogenic.push({
      code: 'PP3',
      strength: 'supporting',
      evidence: `${deleteriousCount}/4 in-silico tools predict deleterious effect`,
    });
  }

  // BA1: Allele frequency >5% in any population
  if (maxFreq > 0.05) {
    benign.push({
      code: 'BA1',
      strength: 'standalone',
      evidence: `Population frequency ${(maxFreq * 100).toFixed(2)}% exceeds 5% threshold`,
    });
  }

  // BS1: Allele frequency greater than expected for disorder
  if (maxFreq > 0.01 && maxFreq <= 0.05) {
    benign.push({
      code: 'BS1',
      strength: 'strong',
      evidence: `Population frequency ${(maxFreq * 100).toFixed(2)}% higher than expected for rare disease`,
    });
  }

  // BP4: Multiple in-silico predictions suggest no impact
  if (deleteriousCount === 0 && variant.consequence === 'missense') {
    benign.push({
      code: 'BP4',
      strength: 'supporting',
      evidence: 'All in-silico tools predict benign/tolerated',
    });
  }

  // BP7: Synonymous variant with no predicted splice impact
  if (variant.consequence === 'synonymous' && (predictions.spliceAI === null || predictions.spliceAI < 0.2)) {
    benign.push({
      code: 'BP7',
      strength: 'supporting',
      evidence: 'Synonymous variant with no splice impact predicted',
    });
  }

  return { pathogenic, benign };
}

/**
 * Calculate ACMG classification from criteria
 */
export function classifyVariant(criteria: ACMGCriteria): {
  classification: VariantClassification['classification'];
  score: number;
} {
  const strengthScores = {
    very_strong: 8, strong: 4, moderate: 2, supporting: 1,
    standalone: 10,
  };

  const pathScore = criteria.pathogenic.reduce(
    (sum, c) => sum + strengthScores[c.strength], 0
  );
  const benignScore = criteria.benign.reduce(
    (sum, c) => sum + strengthScores[c.strength], 0
  );

  const netScore = pathScore - benignScore;

  if (benignScore >= 10) return { classification: 'benign', score: netScore };
  if (benignScore >= 5) return { classification: 'likely_benign', score: netScore };
  if (pathScore >= 10) return { classification: 'pathogenic', score: netScore };
  if (pathScore >= 6) return { classification: 'likely_pathogenic', score: netScore };
  return { classification: 'uncertain_significance', score: netScore };
}

/**
 * Generate a complete variant interpretation report
 */
export function interpretVariant(
  variant: GeneticVariant,
  freq: PopulationFrequency,
  predictions: VariantClassification['inSilicoPredictions'],
  diseaseAssociations: VariantClassification['diseaseAssociations'] = []
): VariantClassification {
  const acmgCriteria = applyACMGCriteria(variant, freq, predictions);
  const { classification, score } = classifyVariant(acmgCriteria);

  const pathCriteria = acmgCriteria.pathogenic.map(c => c.code).join(', ');
  const benignCriteria = acmgCriteria.benign.map(c => c.code).join(', ');

  const narrative = [
    `Variant ${variant.hgvsCoding ?? `${variant.chromosome}:${variant.position}`} in ${variant.gene}`,
    `is classified as ${classification.replace('_', ' ').toUpperCase()}.`,
    variant.consequence !== 'synonymous' ? `This is a ${variant.consequence} variant.` : '',
    pathCriteria ? `Pathogenic criteria met: ${pathCriteria}.` : '',
    benignCriteria ? `Benign criteria met: ${benignCriteria}.` : '',
    freq.clinvarSignificance && freq.clinvarSignificance !== 'not_reported'
      ? `ClinVar reports this variant as ${freq.clinvarSignificance} (${freq.clinvarReviewStars} stars).`
      : '',
    diseaseAssociations.length > 0
      ? `Associated with: ${diseaseAssociations.map(d => d.diseaseName).join(', ')}.`
      : '',
  ].filter(Boolean).join(' ');

  return {
    variant,
    populationFrequency: freq,
    acmgCriteria,
    classification,
    classificationScore: score,
    inSilicoPredictions: predictions,
    diseaseAssociations,
    reportNarrative: narrative,
  };
}
