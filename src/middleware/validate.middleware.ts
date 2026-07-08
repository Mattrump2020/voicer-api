import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { sendError } from '../utils/response';

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const errors = error.details.map((d) => d.message.replace(/"/g, "'"));
      return sendError(res, 'Validation failed', 422, errors);
    }
    next();
  };
};

const uuid = Joi.string().uuid();

export const schemas = {
  register: Joi.object({
    firstName: Joi.string().min(1).max(100).required(),
    lastName:  Joi.string().min(1).max(100).required(),
    email:     Joi.string().email().required(),
    password:  Joi.string().min(8).required(),
  }),

  login: Joi.object({
    email:    Joi.string().email().required(),
    password: Joi.string().required(),
  }),

  forgotPassword: Joi.object({
    email: Joi.string().email().required(),
  }),

  resetPassword: Joi.object({
    token:    Joi.string().required(),
    password: Joi.string().min(8).required(),
  }),

  updateProfile: Joi.object({
    firstName: Joi.string().min(1).max(100),
    lastName:  Joi.string().min(1).max(100),
    country:   Joi.string().max(100),
    gender:    Joi.string().max(20),
    ageRange:  Joi.string().max(20),
  }).min(1),

  createOrganization: Joi.object({
    name:             Joi.string().min(1).max(255).required(),
    description:      Joi.string().max(1000),
    country:          Joi.string().max(100),
    organizationType: Joi.string().max(100),
  }),

  updateOrganization: Joi.object({
    name:             Joi.string().min(1).max(255),
    description:      Joi.string().max(1000),
    country:          Joi.string().max(100),
    organizationType: Joi.string().max(100),
  }).min(1),

  createProject: Joi.object({
    organizationId: uuid.required(),
    name:           Joi.string().min(1).max(255).required(),
    description:    Joi.string().max(1000),
    languages:      Joi.array().items(uuid).min(1).required(),
    startDate:      Joi.string().isoDate(),
    endDate:        Joi.string().isoDate(),
  }),

  updateProject: Joi.object({
    name:        Joi.string().min(1).max(255),
    description: Joi.string().max(1000),
    languages:   Joi.array().items(uuid).min(1),
    startDate:   Joi.string().isoDate(),
    endDate:     Joi.string().isoDate(),
    status:      Joi.string().valid('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'),
  }).min(1),

  inviteMember: Joi.object({
    projectId: uuid.required(),
    email:     Joi.string().email().required(),
    role:      Joi.string().valid('PROJECT_ADMIN', 'CONTRIBUTOR', 'REVIEWER').required(),
  }),

  acceptInvitation: Joi.object({
    token: Joi.string().required(),
  }),

  setUserLanguages: Joi.object({
    languages: Joi.array().items(
      Joi.object({
        languageId:  uuid.required(),
        proficiency: Joi.string().valid('BASIC', 'INTERMEDIATE', 'ADVANCED', 'NATIVE').required(),
      })
    ).min(1).required(),
  }),

  createTask: Joi.object({
    projectId:      uuid.required(),
    title:          Joi.string().min(1).max(255).required(),
    description:    Joi.string().max(1000),
    instructions:   Joi.string().max(2000),
    languageId:     uuid.required(),
    taskType:       Joi.string().valid('READ_PROMPT', 'SPONTANEOUS_SPEECH', 'GUIDED_CONVERSATION').required(),
    targetDuration: Joi.number().integer().min(1),
  }),

  updateTask: Joi.object({
    title:          Joi.string().min(1).max(255),
    description:    Joi.string().max(1000),
    instructions:   Joi.string().max(2000),
    languageId:     uuid,
    taskType:       Joi.string().valid('READ_PROMPT', 'SPONTANEOUS_SPEECH', 'GUIDED_CONVERSATION'),
    targetDuration: Joi.number().integer().min(1),
    status:         Joi.string().valid('ACTIVE', 'INACTIVE', 'CLOSED'),
  }).min(1),

  // No audio file — frontend uploads directly to Supabase Storage
  // and sends back the resulting path + metadata
  createSubmission: Joi.object({
    taskId:        uuid.required(),
    storagePath:   Joi.string().required(),  // path inside Supabase bucket e.g. "audio/uuid.webm"
    languageId:    uuid.required(),
    audioDuration: Joi.number().integer().min(1),
    fileSize:      Joi.number().integer().min(1),
    parentId:      uuid, // optional — only for resubmissions
  }),

  createReview: Joi.object({
    submissionId: uuid.required(),
    rating:       Joi.string().valid('EXCELLENT', 'GOOD', 'FAIR', 'POOR').required(),
    status:       Joi.string().valid('APPROVED', 'REJECTED').required(),
    feedback:     Joi.string().max(2000).when('status', {
      is: 'REJECTED',
      then: Joi.required(), // mandatory on rejection
    }),
  }),

  generateExport: Joi.object({
    projectId:    uuid.required(),
    format:       Joi.string().valid('CSV', 'JSON', 'ZIP').required(),
    approvedOnly: Joi.boolean().default(true),
    languageId:   uuid,
    startDate:    Joi.string().isoDate(),
    endDate:      Joi.string().isoDate(),
  }),

  // Used when frontend wants a signed upload URL from the backend
  requestUploadUrl: Joi.object({
    taskId:   uuid.required(),
    fileName: Joi.string().required(),
    mimeType: Joi.string().valid('audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg').required(),
  }),
};
