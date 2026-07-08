import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title:       'Voicer AI API',
      version:     '1.0.0',
      description: 'Audio dataset collection platform — Express + Drizzle + Supabase',
      contact: { name: 'Voicer AI Team' },
    },
    servers: [
      { url: 'http://localhost:3000/api/v1', description: 'Local development' },
      { url: 'https://api.voicer.ai/api/v1',description: 'Production' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type:         'http',
          scheme:       'bearer',
          bearerFormat: 'JWT',
          description:  'Paste the JWT from POST /auth/login → data.token',
        },
      },
      schemas: {
        // ── Shared ────────────────────────────────────────────────────────
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string'  },
            data:    { },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string'  },
            errors:  { type: 'array', items: { type: 'string' } },
          },
        },
        // ── Auth ──────────────────────────────────────────────────────────
        RegisterBody: {
          type: 'object', required: ['firstName','lastName','email','password'],
          properties: {
            firstName: { type: 'string', example: 'Isaac'              },
            lastName:  { type: 'string', example: 'Sulaimon'           },
            email:     { type: 'string', format: 'email', example: 'isaac@gmail.com' },
            password:  { type: 'string', minLength: 8, example: 'mypassword123'  },
          },
        },
        LoginBody: {
          type: 'object', required: ['email','password'],
          properties: {
            email:    { type: 'string', format: 'email', example: 'isaac@gmail.com' },
            password: { type: 'string', example: 'mypassword123' },
          },
        },
        // ── Organization ──────────────────────────────────────────────────
        CreateOrgBody: {
          type: 'object', required: ['name'],
          properties: {
            name:             { type: 'string', example: 'Nithub Lagos'       },
            description:      { type: 'string', example: 'Innovation hub'     },
            country:          { type: 'string', example: 'Nigeria'            },
            organizationType: { type: 'string', example: 'Research Institution'},
          },
        },
        // ── Project ───────────────────────────────────────────────────────
        CreateProjectBody: {
          type: 'object', required: ['organizationId','name','languages'],
          properties: {
            organizationId: { type: 'string', format: 'uuid' },
            name:           { type: 'string', example: 'Yoruba Speech Dataset' },
            description:    { type: 'string' },
            languages:      { type: 'array', items: { type: 'string', format: 'uuid' } },
            startDate:      { type: 'string', format: 'date', example: '2026-07-01' },
            endDate:        { type: 'string', format: 'date', example: '2026-12-31' },
          },
        },
        // ── Task ──────────────────────────────────────────────────────────
        CreateTaskBody: {
          type: 'object', required: ['projectId','title','languageId','taskType'],
          properties: {
            projectId:      { type: 'string', format: 'uuid' },
            title:          { type: 'string', example: 'Read Yoruba Market Scene' },
            description:    { type: 'string' },
            instructions:   { type: 'string', example: 'Speak clearly at natural pace' },
            languageId:     { type: 'string', format: 'uuid' },
            taskType:       { type: 'string', enum: ['READ_PROMPT','SPONTANEOUS_SPEECH','GUIDED_CONVERSATION'] },
            targetDuration: { type: 'integer', example: 30, description: 'seconds' },
          },
        },
        // ── Submission ────────────────────────────────────────────────────
        RequestUploadUrlBody: {
          type: 'object', required: ['taskId','fileName','mimeType'],
          properties: {
            taskId:   { type: 'string', format: 'uuid' },
            fileName: { type: 'string', example: 'recording.webm' },
            mimeType: { type: 'string', enum: ['audio/webm','audio/wav','audio/mpeg','audio/mp4','audio/ogg'] },
          },
        },
        CreateSubmissionBody: {
          type: 'object', required: ['taskId','storagePath','languageId'],
          properties: {
            taskId:        { type: 'string', format: 'uuid' },
            storagePath:   { type: 'string', example: 'audio/user-id/task-id/uuid.webm' },
            languageId:    { type: 'string', format: 'uuid' },
            audioDuration: { type: 'integer', example: 28, description: 'seconds' },
            fileSize:      { type: 'integer', example: 204800, description: 'bytes' },
            parentId:      { type: 'string', format: 'uuid', description: 'Only for resubmissions' },
          },
        },
        // ── Review ────────────────────────────────────────────────────────
        CreateReviewBody: {
          type: 'object', required: ['submissionId','rating','status'],
          properties: {
            submissionId: { type: 'string', format: 'uuid' },
            rating:       { type: 'string', enum: ['EXCELLENT','GOOD','FAIR','POOR'] },
            status:       { type: 'string', enum: ['APPROVED','REJECTED'] },
            feedback:     { type: 'string', example: 'Clear audio, natural pacing', description: 'Required when status is REJECTED' },
          },
        },
        // ── Export ────────────────────────────────────────────────────────
        CreateExportBody: {
          type: 'object', required: ['projectId','format'],
          properties: {
            projectId:    { type: 'string', format: 'uuid' },
            format:       { type: 'string', enum: ['CSV','JSON','ZIP'] },
            approvedOnly: { type: 'boolean', default: true },
            languageId:   { type: 'string', format: 'uuid' },
            startDate:    { type: 'string', format: 'date' },
            endDate:      { type: 'string', format: 'date' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],

    paths: {
      // ── AUTH ──────────────────────────────────────────────────────────────
      '/auth/register': {
        post: {
          tags: ['Auth'], summary: 'Register a new user', security: [],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterBody' } } } },
          responses: {
            201: { description: 'Registration successful — check email to verify' },
            409: { description: 'Email already in use' },
            422: { description: 'Validation error' },
          },
        },
      },
      '/auth/verify-email': {
        get: {
          tags: ['Auth'], summary: 'Verify email address', security: [],
          parameters: [{ in: 'query', name: 'token', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Email verified' }, 400: { description: 'Invalid/expired token' } },
        },
      },
      '/auth/login': {
        post: {
          tags: ['Auth'], summary: 'Login — returns JWT', security: [],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginBody' } } } },
          responses: {
            200: {
              description: 'Login successful',
              content: { 'application/json': { schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  data: {
                    type: 'object',
                    properties: {
                      token: { type: 'string', description: 'JWT — add to Authorization: Bearer <token>' },
                      user:  { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' } } },
                    },
                  },
                },
              } } },
            },
            401: { description: 'Invalid credentials' },
          },
        },
      },
      '/auth/forgot-password': {
        post: {
          tags: ['Auth'], summary: 'Request password reset email', security: [],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] } } } },
          responses: { 200: { description: 'Reset link sent if account exists' } },
        },
      },
      '/auth/reset-password': {
        post: {
          tags: ['Auth'], summary: 'Reset password using token from email', security: [],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' }, password: { type: 'string', minLength: 8 } }, required: ['token','password'] } } } },
          responses: { 200: { description: 'Password reset' }, 400: { description: 'Invalid/expired token' } },
        },
      },
      '/auth/me': {
        get: { tags: ['Auth'], summary: 'Get current user profile', responses: { 200: { description: 'User profile' }, 401: { description: 'Unauthorized' } } },
      },
      '/auth/profile': {
        patch: {
          tags: ['Auth'], summary: 'Update profile',
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { firstName: { type: 'string' }, lastName: { type: 'string' }, country: { type: 'string' }, gender: { type: 'string' }, ageRange: { type: 'string' } } } } } },
          responses: { 200: { description: 'Profile updated' } },
        },
      },

      // ── ORGANIZATIONS ─────────────────────────────────────────────────────
      '/organizations': {
        post: { tags: ['Organizations'], summary: 'Create organization', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateOrgBody' } } } }, responses: { 201: { description: 'Organization created' } } },
        get:  { tags: ['Organizations'], summary: 'List my organizations', responses: { 200: { description: 'Array of organizations' } } },
      },
      '/organizations/{organizationId}': {
        get:    { tags: ['Organizations'], summary: 'Get organization', parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Organization' } } },
        patch:  { tags: ['Organizations'], summary: 'Update organization (owner only)', parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateOrgBody' } } } }, responses: { 200: { description: 'Updated' } } },
        delete: { tags: ['Organizations'], summary: 'Delete organization (owner only)', parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } },
      },
      '/organizations/{organizationId}/transfer-ownership': {
        patch: {
          tags: ['Organizations'], summary: 'Transfer ownership (owner only)',
          parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { newOwnerId: { type: 'string', format: 'uuid' } }, required: ['newOwnerId'] } } } },
          responses: { 200: { description: 'Ownership transferred' } },
        },
      },
      '/organizations/{organizationId}/dashboard': {
        get: { tags: ['Organizations'], summary: 'Dashboard stats', parameters: [{ in: 'path', name: 'organizationId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Stats' } } },
      },

      // ── PROJECTS ──────────────────────────────────────────────────────────
      '/projects': {
        post: { tags: ['Projects'], summary: 'Create project (org owner only)', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateProjectBody' } } } }, responses: { 201: { description: 'Project created' } } },
        get:  { tags: ['Projects'], summary: 'List projects I am a member of', parameters: [{ in: 'query', name: 'organizationId', schema: { type: 'string' } }], responses: { 200: { description: 'Projects array' } } },
      },
      '/projects/{projectId}': {
        get:    { tags: ['Projects'], summary: 'Get project + languages', parameters: [{ in: 'path', name: 'projectId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Project' } } },
        patch:  { tags: ['Projects'], summary: 'Update project (admin)', parameters: [{ in: 'path', name: 'projectId', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateProjectBody' } } } }, responses: { 200: { description: 'Updated' } } },
        delete: { tags: ['Projects'], summary: 'Delete project (org owner)', parameters: [{ in: 'path', name: 'projectId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } },
      },
      '/projects/{projectId}/archive':   { patch: { tags: ['Projects'], summary: 'Archive project', parameters: [{ in: 'path', name: 'projectId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Archived' } } } },
      '/projects/{projectId}/dashboard': { get:   { tags: ['Projects'], summary: 'Project dashboard stats', parameters: [{ in: 'path', name: 'projectId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Stats' } } } },

      // ── MEMBERS ───────────────────────────────────────────────────────────
      '/members/invite': {
        post: {
          tags: ['Members'], summary: 'Invite a member to a project',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { projectId: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, role: { type: 'string', enum: ['PROJECT_ADMIN','CONTRIBUTOR','REVIEWER'] } }, required: ['projectId','email','role'] } } } },
          responses: { 201: { description: 'Invitation sent' } },
        },
      },
      '/members/accept-invitation': {
        post: {
          tags: ['Members'], summary: 'Accept a project invitation (must be logged in)',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] } } } },
          responses: { 200: { description: 'Joined project' }, 403: { description: 'Email mismatch' }, 410: { description: 'Invitation expired' } },
        },
      },
      '/members/projects/{projectId}': {
        get: { tags: ['Members'], summary: 'List project members + pending invitations', parameters: [{ in: 'path', name: 'projectId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Members and pending invites' } } },
      },
      '/members/{memberId}/role': {
        patch: { tags: ['Members'], summary: 'Update member role', parameters: [{ in: 'path', name: 'memberId', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { role: { type: 'string', enum: ['PROJECT_ADMIN','CONTRIBUTOR','REVIEWER'] } } } } } }, responses: { 200: { description: 'Role updated' } } },
      },
      '/members/{memberId}': {
        delete: { tags: ['Members'], summary: 'Remove member', parameters: [{ in: 'path', name: 'memberId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Removed' } } },
      },

      // ── LANGUAGES ─────────────────────────────────────────────────────────
      '/languages':      { get:  { tags: ['Languages'], summary: 'List all supported languages',        security: [], responses: { 200: { description: 'Languages array' } } } },
      '/languages/user': {
        get:  { tags: ['Languages'], summary: 'Get my language proficiencies',    responses: { 200: { description: 'User languages' } } },
        post: { tags: ['Languages'], summary: 'Set my language proficiencies (replaces all)', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { languages: { type: 'array', items: { type: 'object', properties: { languageId: { type: 'string', format: 'uuid' }, proficiency: { type: 'string', enum: ['BASIC','INTERMEDIATE','ADVANCED','NATIVE'] } }, required: ['languageId','proficiency'] } } }, required: ['languages'] } } } }, responses: { 200: { description: 'Updated' } } },
      },

      // ── TASKS ─────────────────────────────────────────────────────────────
      '/tasks': {
        post: { tags: ['Tasks'], summary: 'Create task (project admin)', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTaskBody' } } } }, responses: { 201: { description: 'Task created' } } },
        get:  { tags: ['Tasks'], summary: 'List tasks in a project', parameters: [{ in: 'query', name: 'projectId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Tasks' } } },
      },
      '/tasks/contributor/available': { get: { tags: ['Tasks'], summary: 'Language-matched tasks for contributor', parameters: [{ in: 'query', name: 'projectId', schema: { type: 'string' } }], responses: { 200: { description: 'Available tasks' } } } },
      '/tasks/{taskId}': {
        get:    { tags: ['Tasks'], summary: 'Get task', parameters: [{ in: 'path', name: 'taskId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Task' } } },
        patch:  { tags: ['Tasks'], summary: 'Update task', parameters: [{ in: 'path', name: 'taskId', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTaskBody' } } } }, responses: { 200: { description: 'Updated' } } },
        delete: { tags: ['Tasks'], summary: 'Delete task (blocks if approved submissions exist)', parameters: [{ in: 'path', name: 'taskId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' }, 400: { description: 'Has approved submissions' } } },
      },

      // ── SUBMISSIONS ───────────────────────────────────────────────────────
      '/submissions/upload-url': {
        post: {
          tags: ['Submissions'], summary: 'Step 1 — get signed upload URL (server controls storage path)',
          description: 'Frontend uses the returned uploadUrl to PUT the file directly to Supabase Storage. File never passes through Express.',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RequestUploadUrlBody' } } } },
          responses: { 200: { description: 'uploadUrl (valid 5 min) + storagePath' } },
        },
      },
      '/submissions': {
        post: {
          tags: ['Submissions'], summary: 'Step 2 — create submission record after upload',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateSubmissionBody' } } } },
          responses: { 201: { description: 'Submission created' } },
        },
      },
      '/submissions/contributor/history':   { get: { tags: ['Submissions'], summary: 'Contributor submission history', parameters: [{ in: 'query', name: 'projectId', schema: { type: 'string' } }, { in: 'query', name: 'status', schema: { type: 'string', enum: ['PENDING_REVIEW','APPROVED','REJECTED','NEEDS_REVISION'] } }], responses: { 200: { description: 'History' } } } },
      '/submissions/contributor/dashboard': { get: { tags: ['Submissions'], summary: 'Contributor dashboard stats', responses: { 200: { description: 'Stats' } } } },
      '/submissions/{submissionId}': {
        get: {
          tags: ['Submissions'], summary: 'Get submission + signed audio URL',
          description: 'Returns a signed URL valid for 1 hour. The private bucket means the URL expires — regenerate by calling this endpoint again.',
          parameters: [{ in: 'path', name: 'submissionId', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Submission with audioUrl' } },
        },
      },

      // ── REVIEWS ───────────────────────────────────────────────────────────
      '/reviews/queue': {
        get: {
          tags: ['Reviews'], summary: 'Reviewer queue — pending submissions matching reviewer\'s languages',
          parameters: [{ in: 'query', name: 'projectId', schema: { type: 'string' } }],
          responses: { 200: { description: 'Queue with signed audio URLs' } },
        },
      },
      '/reviews': {
        post: {
          tags: ['Reviews'], summary: 'Submit a review',
          description: 'feedback is REQUIRED when status=REJECTED. POOR rating always results in REJECTED regardless of status field.',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateReviewBody' } } } },
          responses: { 201: { description: 'Review submitted' }, 400: { description: 'Missing feedback on rejection / already reviewed' } },
        },
      },
      '/reviews/reviewer/history':   { get: { tags: ['Reviews'], summary: 'Reviewer history', parameters: [{ in: 'query', name: 'projectId', schema: { type: 'string' } }], responses: { 200: { description: 'History' } } } },
      '/reviews/reviewer/dashboard': { get: { tags: ['Reviews'], summary: 'Reviewer dashboard stats', responses: { 200: { description: 'Stats' } } } },

      // ── NOTIFICATIONS ─────────────────────────────────────────────────────
      '/notifications': {
        get: { tags: ['Notifications'], summary: 'Get notifications', parameters: [{ in: 'query', name: 'unreadOnly', schema: { type: 'boolean' } }], responses: { 200: { description: 'Notifications + unreadCount' } } },
      },
      '/notifications/read-all':           { patch: { tags: ['Notifications'], summary: 'Mark all as read', responses: { 200: { description: 'Done' } } } },
      '/notifications/{notificationId}/read': { patch: { tags: ['Notifications'], summary: 'Mark one as read', parameters: [{ in: 'path', name: 'notificationId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Done' } } } },

      // ── EXPORTS ───────────────────────────────────────────────────────────
      '/exports': {
        post: { tags: ['Exports'], summary: 'Start a dataset export (async)', description: 'Returns exportId immediately. Poll GET /exports/:id until status=READY, then call GET /exports/:id/download for a signed URL.', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateExportBody' } } } }, responses: { 201: { description: 'Export started' } } },
        get:  { tags: ['Exports'], summary: 'List my exports', parameters: [{ in: 'query', name: 'projectId', schema: { type: 'string' } }], responses: { 200: { description: 'Exports' } } },
      },
      '/exports/{exportId}':          { get: { tags: ['Exports'], summary: 'Poll export status', parameters: [{ in: 'path', name: 'exportId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Export record with status' } } } },
      '/exports/{exportId}/download': { get: { tags: ['Exports'], summary: 'Get signed download URL (only when status=READY)', parameters: [{ in: 'path', name: 'exportId', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'downloadUrl valid 10 min' }, 202: { description: 'Still processing' } } } },
    },
  },
  apis: [], // all paths defined above inline
};

export const swaggerSpec = swaggerJsdoc(options);
