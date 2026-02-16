# Cave Backend - MVP Development Plan

**Goal**: Build core sync and social features first. 3D processing comes later.

---

## Phase 1: MVP - Sync + Basic Social

### Objectives

1. Users can create accounts via Google OAuth
2. Users can register their Orange Pi devices via QR code
3. cave-server instances can sync data with cave-backend
4. Users can browse public caves on the web
5. Users can comment, upload photos, and edit descriptions

---

## Development Milestones

### Milestone 1: Project Setup ✅
**Duration**: 1 day

- [x] Create Django project structure
- [x] Set up PostgreSQL database
- [x] Create continuity documents (CLAUDE.md, README.md, etc.)
- [x] Set up git repository
- [x] Push to GitHub

### Milestone 2: User Authentication
**Duration**: 2-3 days

**Tasks**:
- [ ] Install and configure django-allauth
- [ ] Set up Google OAuth credentials
- [ ] Create User and UserProfile models
- [ ] Implement login/logout views
- [ ] Create user profile API endpoints
- [ ] Basic React login page

**Deliverables**:
- Users can sign in with Google
- User profile page displays basic info
- API: `POST /api/auth/google/`, `GET /api/auth/user/`

**Testing**:
- Manual: Sign in with Google account
- Unit: User model creation
- Integration: OAuth flow

---

### Milestone 3: Device Management
**Duration**: 3-4 days

**Tasks**:
- [ ] Create Device model (serial number, MAC, owner)
- [ ] Implement QR code generation for device registration
- [ ] Create device registration API
- [ ] Device authentication token generation
- [ ] React page for device registration
- [ ] QR code scanner integration (future: on Orange Pi)

**Deliverables**:
- User can register a device via QR code
- Device receives authentication token
- Device list page shows user's devices
- API: `POST /api/devices/register/`, `GET /api/devices/`

**Testing**:
- Manual: Register mock device, view device list
- Unit: Device model, token generation
- Integration: Registration flow

---

### Milestone 4: Cave Data Models
**Duration**: 2-3 days

**Tasks**:
- [ ] Create Cave model (extend from cave-server schema)
- [ ] Create POI model
- [ ] Create CavePhoto model
- [ ] Create DescriptionRevision model (wiki-style versioning)
- [ ] Create CavePermission model (owner/editor/viewer)
- [ ] Database migrations

**Deliverables**:
- Database schema matches cave-server
- Permission system in place
- Models tested

**Testing**:
- Unit: Model creation, relationships, constraints
- Migration: Apply migrations cleanly

---

### Milestone 5: Cave API Endpoints
**Duration**: 3-4 days

**Tasks**:
- [ ] Create Cave serializers (list, detail)
- [ ] Implement cave list endpoint (filter by permissions)
- [ ] Implement cave detail endpoint
- [ ] Implement cave create/update/delete
- [ ] Permission enforcement (owner only for delete)
- [ ] Public/Private/Limited Public filtering
- [ ] React cave list page
- [ ] React cave detail page

**Deliverables**:
- Users can browse caves they have permission to see
- Cave detail page shows map data, POIs, photos
- API: `GET /api/caves/`, `POST /api/caves/`, `GET/PATCH/DELETE /api/caves/{id}/`

**Testing**:
- Manual: Create cave, view list, view detail
- Unit: Serializers, permission logic
- Integration: CRUD operations with different user roles

---

### Milestone 6: S3 File Storage
**Duration**: 2 days

**Tasks**:
- [ ] Configure boto3 for S3 (or S3-compatible storage)
- [ ] Implement file upload for photos
- [ ] Implement file upload for PCD files
- [ ] Generate pre-signed URLs for download
- [ ] Test large file uploads (2GB+)

**Deliverables**:
- Photos upload to S3, URLs stored in database
- PCD files upload to S3 with multipart support
- Pre-signed URLs for secure file access

**Testing**:
- Manual: Upload photo, upload PCD file
- Integration: Large file upload (>1GB)

---

### Milestone 7: Sync Mechanism
**Duration**: 5-7 days (complex!)

**Tasks**:
- [ ] Create SyncSession model (track sync sessions)
- [ ] Create DataDelta model (changed records)
- [ ] Implement sync start endpoint (device authenticates)
- [ ] Implement delta comparison logic
- [ ] Implement push endpoint (device → backend)
- [ ] Implement pull endpoint (backend → device)
- [ ] Implement sync complete endpoint
- [ ] Handle large PCD file uploads during sync
- [ ] Test with mock cave-server client

**Deliverables**:
- cave-server can sync with cave-backend
- Device pushes new caves, POIs, photos
- Device receives requested maps and updates
- API: `POST /api/sync/start/`, `POST /api/sync/push/`, `GET /api/sync/pull/`, `POST /api/sync/complete/`

**Testing**:
- Manual: Run sync with mock device data
- Integration: Full sync flow end-to-end
- Unit: Delta comparison logic

---

### Milestone 8: Social Features - Comments
**Duration**: 2-3 days

**Tasks**:
- [ ] Create Comment model (cave, POI, user)
- [ ] Implement comment create API
- [ ] Implement comment list API
- [ ] React comment list component
- [ ] React comment form

**Deliverables**:
- Users can add comments to caves and POIs
- Comments display on cave detail page
- API: `POST /api/caves/{id}/comments/`, `GET /api/caves/{id}/comments/`

**Testing**:
- Manual: Add comment, view comments
- Unit: Comment model
- Integration: Comment CRUD

---

### Milestone 9: Social Features - Photos & Descriptions
**Duration**: 3-4 days

**Tasks**:
- [ ] Photo upload API for caves
- [ ] Photo tagging (users, POIs)
- [ ] Wiki-style description editing
- [ ] Description revision history
- [ ] React photo gallery component
- [ ] React description editor (Markdown)
- [ ] React revision history viewer

**Deliverables**:
- Users can upload photos to caves
- Users can edit cave descriptions (wiki-style)
- Revision history preserved
- API: `POST /api/caves/{id}/photos/`, `PATCH /api/caves/{id}/description/`, `GET /api/caves/{id}/revisions/`

**Testing**:
- Manual: Upload photo, edit description, view history
- Unit: Revision creation logic
- Integration: Multi-user concurrent edits

---

### Milestone 10: Grotto Memberships
**Duration**: 2-3 days

**Tasks**:
- [ ] Create Grotto model (organization)
- [ ] Create GrottoMembership model (user → grotto)
- [ ] Grotto cave ownership (caves owned by grotto)
- [ ] Permission inheritance (grotto members → cave permissions)
- [ ] React grotto management page

**Deliverables**:
- Users can create grottos (organizations)
- Grottos can own caves
- Grotto members inherit permissions
- API: `POST /api/grottos/`, `GET /api/grottos/`, `POST /api/grottos/{id}/members/`

**Testing**:
- Manual: Create grotto, add members, verify permissions
- Unit: Membership logic
- Integration: Permission inheritance

---

## MVP Completion Criteria

### Functional Requirements
- ✅ User can sign in with Google
- ✅ User can register an Orange Pi device
- ✅ cave-server can sync with cave-backend
- ✅ User can browse public caves
- ✅ User can view cave details (map, POIs, photos)
- ✅ User can comment on caves
- ✅ User can upload photos
- ✅ User can edit cave descriptions (wiki-style)
- ✅ Grotto memberships work

### Non-Functional Requirements
- All API endpoints documented
- Unit tests for models and serializers
- Integration tests for sync flow
- Manual testing checklist completed
- Deployment to development server successful

### Documentation
- CLAUDE.md updated with current status
- API_SPEC.md complete
- README.md reflects current functionality

---

## Post-MVP Roadmap

### Phase 2: Advanced Social (3-4 weeks)
- User profiles with exploration stats
- Activity feeds
- Follow/unfollow users
- Ratings and reviews
- Direct messaging (InMail)

### Phase 3: 3D Processing (4-6 weeks)
- PCD → mesh generation pipeline
- Texture mapping from camera images
- GPU-accelerated processing with Celery
- Progress tracking for long jobs

### Phase 4: Virtual Exploration (6-8 weeks)
- Game engine integration (Three.js/Babylon/Unity)
- Browser-based 3D cave exploration
- Mobile and desktop optimization
- Touch controls and keyboard navigation

### Phase 5: Map Stitching (4-6 weeks)
- Automated alignment (ICP, ScanContext)
- Manual stitching UI
- Multi-expedition map merging
- Version control for stitched maps

---

## Development Best Practices

### Code Quality
- Follow PEP 8 for Python code
- Use ESLint for JavaScript/React
- Write docstrings for all functions
- Keep functions small and focused

### Testing
- Write unit tests for all models and serializers
- Write integration tests for API endpoints
- Manual testing checklist for each milestone
- Load testing for sync mechanism

### Git Workflow
- Branch per feature/milestone
- Descriptive commit messages
- Pull requests for review
- Merge to main after testing

### Documentation
- Update CLAUDE.md after each milestone
- Document API changes in API_SPEC.md
- Keep README.md current
- Add inline comments for complex logic

---

## Risk Mitigation

### Risk: Large PCD file uploads (2GB+) may timeout
**Mitigation**: Implement S3 multipart upload, resume capability, progress tracking

### Risk: Sync mechanism is complex and error-prone
**Mitigation**: Extensive testing with mock device, detailed logging, rollback on failure

### Risk: Permission system has edge cases
**Mitigation**: Comprehensive unit tests, manual testing with different user roles

### Risk: Google OAuth credentials exposure
**Mitigation**: Use environment variables, never commit to git, rotate keys regularly

---

## Success Metrics

### MVP Launch
- 2 test caves synced successfully
- 5 test users registered
- Zero critical bugs in sync flow
- All API endpoints documented
- Deployment to dev server successful

### User Feedback
- cave-server can sync reliably
- Web UI is intuitive for browsing caves
- Device registration flow is straightforward

---

## Timeline Estimate

**Total MVP Duration**: 8-10 weeks (assuming 1 developer, full-time)

| Milestone | Duration | Dependencies |
|-----------|----------|--------------|
| 1. Project Setup | 1 day | None |
| 2. User Auth | 2-3 days | Milestone 1 |
| 3. Device Management | 3-4 days | Milestone 2 |
| 4. Cave Models | 2-3 days | Milestone 2 |
| 5. Cave API | 3-4 days | Milestone 4 |
| 6. S3 Storage | 2 days | Milestone 5 |
| 7. Sync Mechanism | 5-7 days | Milestones 3, 5, 6 |
| 8. Comments | 2-3 days | Milestone 5 |
| 9. Photos & Descriptions | 3-4 days | Milestone 6, 8 |
| 10. Grottos | 2-3 days | Milestone 2, 5 |

**Buffer for testing and bug fixes**: +2 weeks

---

## Next Steps

1. Set up Django project structure
2. Configure PostgreSQL connection
3. Install django-allauth
4. Begin Milestone 2 (User Authentication)
