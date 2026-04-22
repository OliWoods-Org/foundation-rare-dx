/**
 * TrialConnector — Clinical trial matching and patient community linking
 *
 * Matches rare disease patients to active clinical trials on ClinicalTrials.gov,
 * generates medical passport documents, and connects patients to condition-specific
 * support communities.
 */

import { z } from 'zod';

// ─── Schemas ───────────────────────────────────────────────────────────────────

export const ClinicalTrialSchema = z.object({
  nctId: z.string().regex(/^NCT\d{8}$/),
  title: z.string(),
  status: z.enum([
    'not_yet_recruiting', 'recruiting', 'enrolling_by_invitation',
    'active_not_recruiting', 'completed', 'suspended', 'terminated', 'withdrawn',
  ]),
  phase: z.enum(['early_phase_1', 'phase_1', 'phase_1_2', 'phase_2', 'phase_2_3', 'phase_3', 'phase_4', 'not_applicable']),
  conditions: z.array(z.string()),
  interventions: z.array(z.object({
    type: z.enum(['drug', 'biological', 'device', 'procedure', 'behavioral', 'genetic', 'dietary', 'other']),
    name: z.string(),
    description: z.string().optional(),
  })),
  eligibilityCriteria: z.object({
    ageMin: z.number().int().nonnegative().optional(),
    ageMax: z.number().int().nonnegative().optional(),
    sex: z.enum(['all', 'male', 'female']),
    acceptsHealthyVolunteers: z.boolean(),
    inclusionCriteria: z.array(z.string()),
    exclusionCriteria: z.array(z.string()),
  }),
  locations: z.array(z.object({
    facility: z.string(),
    city: z.string(),
    state: z.string().optional(),
    country: z.string(),
    contactEmail: z.string().email().optional(),
  })),
  sponsor: z.string(),
  startDate: z.string(),
  estimatedCompletionDate: z.string().optional(),
  url: z.string().url(),
});

export const TrialMatchResultSchema = z.object({
  patientId: z.string().uuid(),
  matchedAt: z.string().datetime(),
  trial: ClinicalTrialSchema,
  matchScore: z.number().min(0).max(1),
  matchReasons: z.array(z.string()),
  potentialBarriers: z.array(z.string()),
  distanceKm: z.number().nonnegative().optional(),
  nextSteps: z.array(z.string()),
});

export const MedicalPassportSchema = z.object({
  patientId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  version: z.number().int().positive(),
  demographics: z.object({
    name: z.string().optional(),
    dateOfBirth: z.string().optional(),
    sex: z.string(),
    bloodType: z.string().optional(),
    allergies: z.array(z.string()),
    emergencyContact: z.object({
      name: z.string(),
      phone: z.string(),
      relationship: z.string(),
    }).optional(),
  }),
  diagnoses: z.array(z.object({
    condition: z.string(),
    diagnosedDate: z.string().optional(),
    diagnosedBy: z.string().optional(),
    icdCode: z.string().optional(),
    orphaCode: z.string().optional(),
    severity: z.enum(['mild', 'moderate', 'severe', 'variable']).optional(),
    status: z.enum(['confirmed', 'suspected', 'ruled_out']),
  })),
  geneticFindings: z.array(z.object({
    gene: z.string(),
    variant: z.string(),
    classification: z.string(),
    testDate: z.string().optional(),
    lab: z.string().optional(),
  })),
  medications: z.array(z.object({
    name: z.string(),
    dose: z.string(),
    frequency: z.string(),
    prescribedFor: z.string(),
    startDate: z.string().optional(),
  })),
  specialistTeam: z.array(z.object({
    role: z.string(),
    name: z.string(),
    institution: z.string(),
    phone: z.string().optional(),
  })),
  keyDocuments: z.array(z.object({
    type: z.enum(['genetic_report', 'imaging', 'biopsy', 'specialist_letter', 'care_plan']),
    title: z.string(),
    date: z.string(),
    url: z.string().url().optional(),
  })),
  qrCodeData: z.string().optional(),
});

export const PatientCommunitySchema = z.object({
  id: z.string(),
  name: z.string(),
  diseaseIds: z.array(z.string()),
  platform: z.enum(['facebook_group', 'reddit', 'discord', 'forum', 'organization', 'rareshare', 'inspire']),
  url: z.string().url(),
  memberCount: z.number().int().nonnegative().optional(),
  languages: z.array(z.string()),
  moderated: z.boolean(),
  description: z.string(),
  activeLevel: z.enum(['very_active', 'active', 'moderate', 'low']),
});

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ClinicalTrial = z.infer<typeof ClinicalTrialSchema>;
export type TrialMatchResult = z.infer<typeof TrialMatchResultSchema>;
export type MedicalPassport = z.infer<typeof MedicalPassportSchema>;
export type PatientCommunity = z.infer<typeof PatientCommunitySchema>;

// ─── Implementation ────────────────────────────────────────────────────────────

/**
 * Match a patient to eligible clinical trials
 */
export function matchTrials(
  patientAge: number,
  patientSex: 'male' | 'female' | 'other',
  patientDiseaseIds: string[],
  patientDiseaseNames: string[],
  trials: ClinicalTrial[],
  patientLocation?: { latitude: number; longitude: number }
): TrialMatchResult[] {
  const results: TrialMatchResult[] = [];

  for (const trial of trials) {
    if (trial.status !== 'recruiting' && trial.status !== 'enrolling_by_invitation') continue;

    // Age check
    const meetsAge = (
      (!trial.eligibilityCriteria.ageMin || patientAge >= trial.eligibilityCriteria.ageMin) &&
      (!trial.eligibilityCriteria.ageMax || patientAge <= trial.eligibilityCriteria.ageMax)
    );
    if (!meetsAge) continue;

    // Sex check
    if (trial.eligibilityCriteria.sex !== 'all') {
      if (trial.eligibilityCriteria.sex !== patientSex) continue;
    }

    // Disease match
    const matchReasons: string[] = [];
    let conditionMatch = false;

    for (const condition of trial.conditions) {
      const condLower = condition.toLowerCase();
      for (const name of patientDiseaseNames) {
        if (condLower.includes(name.toLowerCase()) || name.toLowerCase().includes(condLower)) {
          conditionMatch = true;
          matchReasons.push(`Condition match: "${condition}"`);
          break;
        }
      }
    }

    if (!conditionMatch) continue;

    const potentialBarriers: string[] = [];
    if (trial.locations.length === 0) {
      potentialBarriers.push('No locations listed — may require direct contact');
    }

    // Score based on match quality
    let matchScore = 0.5; // Base score for condition match
    if (trial.phase === 'phase_3' || trial.phase === 'phase_2_3') matchScore += 0.2;
    if (trial.status === 'recruiting') matchScore += 0.1;
    if (matchReasons.length > 1) matchScore += 0.1;
    matchScore = Math.min(1, matchScore);

    const nextSteps = [
      `Review full eligibility at ${trial.url}`,
      trial.locations.length > 0
        ? `Contact nearest site: ${trial.locations[0].facility}, ${trial.locations[0].city}`
        : 'Contact sponsor for site information',
      'Discuss with your treating physician before enrolling',
    ];

    results.push({
      patientId: crypto.randomUUID(),
      matchedAt: new Date().toISOString(),
      trial,
      matchScore: Math.round(matchScore * 100) / 100,
      matchReasons,
      potentialBarriers,
      nextSteps,
    });
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * Generate a medical passport — portable summary for new providers
 */
export function generateMedicalPassport(
  patientId: string,
  demographics: MedicalPassport['demographics'],
  diagnoses: MedicalPassport['diagnoses'],
  geneticFindings: MedicalPassport['geneticFindings'],
  medications: MedicalPassport['medications'],
  specialistTeam: MedicalPassport['specialistTeam'],
  keyDocuments: MedicalPassport['keyDocuments']
): MedicalPassport {
  const passport: MedicalPassport = {
    patientId,
    generatedAt: new Date().toISOString(),
    version: 1,
    demographics,
    diagnoses,
    geneticFindings,
    medications,
    specialistTeam,
    keyDocuments,
  };

  // Generate QR code data as a compact JSON summary
  const qrData = JSON.stringify({
    id: patientId,
    dx: diagnoses.filter(d => d.status === 'confirmed').map(d => d.condition),
    genes: geneticFindings.map(g => `${g.gene}:${g.variant}`),
    allergies: demographics.allergies,
    meds: medications.map(m => m.name),
    emergency: demographics.emergencyContact?.phone,
    generated: passport.generatedAt,
  });

  passport.qrCodeData = qrData;

  return passport;
}

/**
 * Find relevant patient communities for a diagnosed condition
 */
export function findCommunities(
  diseaseNames: string[],
  preferredLanguages: string[] = ['en'],
  knownCommunities: PatientCommunity[] = []
): PatientCommunity[] {
  return knownCommunities
    .filter(c => {
      const nameMatch = diseaseNames.some(dn =>
        c.name.toLowerCase().includes(dn.toLowerCase()) ||
        c.description.toLowerCase().includes(dn.toLowerCase())
      );
      const langMatch = c.languages.some(l => preferredLanguages.includes(l));
      return nameMatch && langMatch;
    })
    .sort((a, b) => {
      const activeOrder = { very_active: 0, active: 1, moderate: 2, low: 3 };
      return activeOrder[a.activeLevel] - activeOrder[b.activeLevel];
    });
}
