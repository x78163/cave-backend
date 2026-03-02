# Cave Backend - AI Continuity Document

## Project Overview

**Cave Backend** is a cloud-hosted Django web service that provides synchronization, social media, and computational services for the Cave Mapper ecosystem. It acts as the central repository and processing hub for cave mapping data collected by portable Orange Pi-based cave-mapper devices.

**Current Status**: Active development — full Django backend + React frontend operational with cave CRUD, social features, 2D/3D map viewing, GIS parcel integration, and user auth

---

## System Context

### Related Projects

1. **cave-mapper** (https://github.com/x78163/cave-mapper)
   - Portable Orange Pi 5 Plus cave mapping device
   - Livox Mid-360 LiDAR + FAST-LIO SLAM
   - Real-time 3D mapping in GPS-denied environments
   - PyQt5 GUI for mapping/localization

2. **cave-server** (https://github.com/x78163/cave-server)
   - Django web service running ON the Orange Pi device
   - Local collaboration in internet-denied cave environments
   - REST API for cave data, POIs, photos
   - React/Vite frontend for expedition members
   - Syncs with cave-backend when internet available

### Architecture Relationship

```
┌─────────────────────────┐
│   cave-mapper (Device)  │  ← Hardware + ROS2 SLAM
│   Orange Pi 5 Plus      │
└───────────┬─────────────┘
            │
            ↓
┌─────────────────────────┐
│  cave-server (Device)   │  ← Local Django on device
│  WiFi AP + Local DB     │     (Internet-denied collaboration)
└───────────┬─────────────┘
            │ WiFi Sync
            ↓
┌─────────────────────────┐
│  cave-backend (Cloud)   │  ← THIS PROJECT
│  Sync + Social + GPU    │
└───────────┬─────────────┘
            │
            ↓
┌─────────────────────────┐
│  Web App (Public)       │  ← Users access caves
│  Mobile + Desktop       │     (virtual exploration)
└─────────────────────────┘
```

---

## Core Functionality

### MVP Phase (Current Priority)

1. **User Management**
   - Google OAuth authentication
   - User profiles with exploration stats
   - Grotto memberships (group permissions)

2. **Device Management**
   - QR code device registration (like WhatsApp)
   - Serial number / MAC address linking
   - Multiple devices per user/organization
   - Device authentication tokens

3. **Cave Data Sync**
   - Automatic sync when device connects to WiFi
   - Device pushes deltas (new maps, photos, POIs)
   - Backend pushes updates (requested maps, comments, edits)
   - Full PCD files + keyframes + photos

4. **Cave Repository**
   - Cave profiles with metadata
   - Public / Private / Limited Public visibility
   - Owner / Editor / Viewer permissions
   - Share via QR code or URL with embedded permissions

5. **Basic Social Features**
   - Comments on caves and POIs
   - Photo uploads and tagging
   - Wiki-style cave description editing with version history
   - User profiles and activity tracking

### Post-MVP Phase

6. **3D Processing Pipeline** (Requires GPU)
   - PCD → 3D mesh generation
   - Texture mapping from 3x camera images
   - Environmental data overlay (gas/particulate hues)
   - Gaussian splatting or similar reconstruction

7. **Virtual Cave Exploration**
   - Browser-based 3D exploration (game engine)
   - Mobile and desktop support
   - "Walk through" caves virtually
   - Performance throttling based on device

8. **Map Stitching**
   - Automatic alignment of overlapping segments
   - Manual UI for fine-tuning alignment
   - Point cloud subtraction for overlap visualization
   - Multi-expedition map merging

9. **Advanced Social Features**
   - InMail / direct messaging
   - User walls and activity feeds
   - Follow users
   - Ratings and reviews
   - Advertising integration

---

## Technology Stack

### Backend
- **Framework**: Django 4.2+ (Python 3.10+)
- **Database**: PostgreSQL (matching cave-server schema)
- **API**: Django REST Framework
- **Authentication**: Google OAuth 2.0 (django-allauth)
- **Storage**: S3-compatible (AWS S3 or NameHero object storage)
- **Task Queue**: Celery + Redis (for 3D processing jobs)

### Frontend
- **Framework**: React 18+ with Vite
- **State Management**: React Context or Redux (TBD)
- **Maps**: Leaflet (for surface maps)
- **3D Viewer**: Three.js / Babylon.js / Game engine (TBD in post-MVP)

### Infrastructure
- **Initial Deployment**: Windows PC with WSL2 + NVIDIA 4090 GPU
- **Production Deployment**: AWS / NameHero VPS
- **GPU Processing**: CUDA-based point cloud processing
- **CI/CD**: GitHub Actions (TBD)

---

## Database Schema

Cave Backend extends cave-server's schema with cloud-specific models:

### Shared Models (from cave-server)
- `Cave` - Core cave profile
- `POI` (Point of Interest) - 11 types
- `CavePhoto` - Photos associated with caves
- `DescriptionRevision` - Wiki-style version history

### New Models (cave-backend specific)

#### User Management
- `User` - Django auth user (Google OAuth)
- `UserProfile` - Extended profile (bio, stats, avatar, `invited_by` FK)
- `Grotto` - Organization/group
- `GrottoMembership` - User → Grotto relationship
- `InviteCode` - Gated registration codes (8-char auto-generated, use counting, active/inactive toggle)

#### Device Management
- `Device` - Registered Orange Pi devices
  - `serial_number` / `mac_address`
  - `owner` (User FK)
  - `registration_qr_code`
  - `last_sync_at`

#### Permissions
- `CavePermission` - Per-user cave access
  - `cave`, `user`, `role` (owner/editor/viewer)
- `CaveShareLink` - Temporary share links with QR codes

#### Social Features
- `Comment` - Comments on caves/POIs
- `CaveRating` - User ratings
- `UserFollow` - Follow relationships
- `Activity` - Activity feed entries

#### Real-Time Chat
- `Channel` - Chat channels (UUID PK, name, channel_type dm/channel, description, created_by FK, grotto FK nullable)
- `ChannelMembership` - User↔Channel membership (role owner/member, last_read_message_id for unread tracking)
- `Message` - Chat messages (UUID PK, channel FK, author FK, content, created_at, edited_at, is_deleted, deleted_at, reply_to self-FK, is_pinned, pinned_by FK, pinned_at)
- `MessageReaction` - Emoji reactions (message FK, user FK, emoji, unique_together)
- `MessageMention` - @mention tracking (message FK, user FK, unique_together)
- `Notification` - User notifications (user FK, type mention/reply/pin, message FK, channel FK, actor FK, is_read)

#### Traditional Survey
- `CaveSurvey` - Survey metadata (name, date, surveyors, unit, declination, computed totals, source: manual/slam)
- `SurveyStation` - Computed station positions (x/y/z), optional fixed GPS coordinates
- `SurveyShot` - Station-to-station measurements (azimuth, distance, inclination, LRUD)

#### Events
- `Event` - Community event (UUID PK, name, event_type, description, start_date, end_date, all_day, cave FK, lat/lon, address, google_maps_link, created_by, point_of_contact, grotto FK, required_equipment, max_participants, visibility: public/all_grotto/grotto_only/unlisted/private, status: draft/published/cancelled/completed, cover_image)
- `EventRSVP` - RSVP to event (event FK, user FK, status: going/maybe/not_going, unique_together)
- `EventInvitation` - Invitation to private event (event FK, invited_user XOR invited_grotto, invited_by, status: pending/accepted/declined)
- `EventComment` - Comment on event (event FK, author FK, text)

#### Sync Management
- `SyncSession` - Track sync sessions
- `SyncLog` - Detailed sync logs
- `DataDelta` - Changed records since last sync

---

## API Endpoints (REST)

### Authentication
- `POST /api/auth/google/` - Google OAuth login
- `POST /api/auth/logout/` - Logout
- `GET /api/auth/user/` - Current user info
- `POST /api/users/auth/register/` - Register with invite code (returns JWT tokens)
- `GET/POST /api/users/invite-codes/` - List user's codes (admin sees all) / generate new code
- `PATCH/DELETE /api/users/invite-codes/{id}/` - Toggle active / delete code

### Device Management
- `POST /api/devices/register/` - Register new device (QR code)
- `GET /api/devices/` - List user's devices
- `POST /api/devices/{id}/authenticate/` - Device auth token

### Cave Management
- `GET /api/caves/` - List caves (filtered by permissions)
- `POST /api/caves/` - Create cave
- `GET /api/caves/{id}/` - Cave detail
- `PATCH /api/caves/{id}/` - Update cave
- `DELETE /api/caves/{id}/` - Delete cave (owner or admin only)
- `POST /api/caves/{id}/share/` - Generate share link/QR
- `POST /api/caves/reverse-geocode/` - Reverse geocode lat/lon to city/state/country/zip (Nominatim)
- `POST /api/caves/proximity-check/` - Check for existing caves within ~50m of coordinates
- `GET /api/caves/{id}/nearby/` - Find caves within 300m (visibility-filtered, includes distance + has_survey)

### Sync Endpoints
- `POST /api/sync/start/` - Initiate sync session
- `POST /api/sync/push/` - Push device data
- `GET /api/sync/pull/` - Pull backend updates
- `POST /api/sync/complete/` - Finalize sync

### Social Endpoints
- `POST /api/caves/{id}/comments/` - Add comment
- `GET /api/caves/{id}/comments/` - List comments
- `POST /api/caves/{id}/photos/` - Upload photo
- `POST /api/users/{id}/follow/` - Follow user
- `GET /api/feed/` - Activity feed
- `GET/POST /api/social/posts/` - List feed / create post (supports image upload)
- `GET/DELETE /api/social/posts/{id}/` - Get or delete post (soft delete if comments exist)
- `POST/DELETE /api/social/posts/{id}/react/` - Add/remove reaction (like/dislike)
- `GET/POST /api/social/posts/{id}/comments/` - List or add comments (blocked on deleted posts)

### User Media Endpoints
- `GET /api/users/profile/{id}/media/` - All user media (photos, documents, video links + post images)
- `PATCH /api/users/media/{type}/{uuid}/` - Update media visibility (public/unlisted/private)

### Survey Map Overlays
- `GET /api/caves/{id}/survey-maps/` - List survey maps for cave
- `POST /api/caves/{id}/survey-maps/` - Upload + process survey image
- `GET /api/caves/{id}/survey-maps/{survey_id}/` - Survey map detail
- `PATCH /api/caves/{id}/survey-maps/{survey_id}/` - Update calibration
- `DELETE /api/caves/{id}/survey-maps/{survey_id}/` - Delete survey map

### Traditional Cave Surveys
- `GET /api/caves/{id}/surveys/` - List surveys for cave
- `POST /api/caves/{id}/surveys/` - Create new survey
- `GET /api/caves/{id}/surveys/{survey_id}/` - Survey detail with stations + shots
- `PATCH /api/caves/{id}/surveys/{survey_id}/` - Update survey metadata
- `DELETE /api/caves/{id}/surveys/{survey_id}/` - Delete survey
- `POST /api/caves/{id}/surveys/{survey_id}/shots/` - Bulk add shots (auto-creates stations)
- `PATCH /api/caves/{id}/surveys/{survey_id}/shots/{shot_id}/` - Update shot
- `DELETE /api/caves/{id}/surveys/{survey_id}/shots/{shot_id}/` - Delete shot
- `POST /api/caves/{id}/surveys/{survey_id}/compute/` - Recompute station positions + render data
- `GET /api/caves/{id}/surveys/{survey_id}/render/` - Get computed render data
- `POST /api/caves/{id}/surveys/{survey_id}/ocr/` - OCR extract shots from survey sheet photo
- `POST /api/caves/{id}/generate-slam-survey/` - Generate traditional survey from SLAM map data (level='all' for merged multi-level, level=0/1/... for single level)

### Documents & Video Links
- `POST /api/caves/{id}/documents/` - Upload PDF document
- `PATCH/DELETE /api/caves/{id}/documents/{doc_id}/` - Edit/delete document
- `POST /api/caves/{id}/video-links/` - Add video link (auto-detects platform)
- `PATCH/DELETE /api/caves/{id}/video-links/{video_id}/` - Edit/delete video link
- `GET/POST /api/caves/{id}/annotations/` - List/create surface annotations (polygons)
- `PATCH/DELETE /api/caves/{id}/annotations/{annotation_id}/` - Update/delete annotation

### Chat Endpoints
- `GET /api/chat/channels/` - List user's channels (with last_message, unread_count, other_user for DMs)
- `POST /api/chat/channels/` - Create named channel
- `GET /api/chat/channels/{id}/` - Channel detail with members
- `GET /api/chat/channels/{id}/messages/` - Cursor-paginated history (?before=uuid&limit=50)
- `POST /api/chat/channels/{id}/mark-read/` - Update read cursor
- `POST /api/chat/channels/{id}/members/` - Add member to channel
- `DELETE /api/chat/channels/{id}/leave/` - Leave channel
- `POST /api/chat/dm/` - Get-or-create DM with {user_id} (respects allow_dms)
- `GET /api/chat/unread-count/` - Total unread for nav badge
- `GET /api/users/search/?q=<query>` - User search for DM targeting
- `POST /api/chat/channels/{id}/messages/{msg_id}/react/` - Toggle emoji reaction
- `GET /api/chat/channels/{id}/messages/{msg_id}/reactors/?emoji=X` - List users who reacted (capped at 20)
- `POST /api/chat/channels/{id}/send/` - Send message with attachment (REST upload, supports reply_to)
- `PATCH /api/chat/channels/{id}/messages/{msg_id}/` - Edit message (author only, re-parses mentions)
- `DELETE /api/chat/channels/{id}/messages/{msg_id}/` - Soft delete message (author or channel owner)
- `POST /api/chat/channels/{id}/messages/{msg_id}/pin/` - Toggle pin (any member, creates notification)
- `GET /api/chat/channels/{id}/pinned/` - List pinned messages
- `GET /api/chat/channels/{id}/messages/{msg_id}/replies/` - List replies (flat, one level)
- `GET /api/chat/messages/search/?q=&channel_id=` - Search messages (user's channels, content icontains)
- `GET /api/chat/notifications/` - User's notifications (optional ?unread_only=true)
- `GET /api/chat/notifications/count/` - Unread notification count
- `POST /api/chat/notifications/{id}/read/` - Mark single notification read
- `POST /api/chat/notifications/read-all/` - Bulk mark all read
- `WS /ws/chat/?token=<jwt>` - WebSocket (multiplexed, handles chat.message, chat.mark_read, chat.join_channel, chat.typing, chat.react + broadcasts message_edit, message_delete, message_pin, notification)

### Events
- `GET /api/events/` - List events (visibility-filtered, `?type=`, `?start=`, `?end=`, `?grotto=`, `?cave=`, `?mine=true`)
- `POST /api/events/` - Create event
- `GET /api/events/{id}/` - Event detail (RSVP counts, user's RSVP, comments)
- `PATCH /api/events/{id}/` - Update event (creator/admin)
- `DELETE /api/events/{id}/` - Delete event (creator/admin)
- `POST /api/events/{id}/rsvp/` - RSVP (`{status: 'going'/'not_going'}`) with capacity check (409 when full)
- `DELETE /api/events/{id}/rsvp/` - Cancel RSVP
- `GET /api/events/{id}/rsvps/` - List RSVPs (with avatar, avatar_preset)
- `POST /api/events/{id}/invitations/` - Send invitation (`{user_id}` or `{grotto_id}`)
- `PATCH /api/events/invitations/{id}/` - Accept/decline invitation
- `GET /api/events/{id}/comments/` - List comments
- `POST /api/events/{id}/comments/` - Add comment
- `DELETE /api/events/{id}/comments/{cid}/` - Delete comment (author/admin)
- `GET /api/events/calendar/` - Lightweight calendar data (`?start=&end=`)
- `GET /api/events/my-events/` - Events user created or RSVPed to
- `GET /api/events/user/{user_id}/` - Events a user is attending, invited to, or created

### 3D Processing (Post-MVP)
- `POST /api/caves/{id}/generate-mesh/` - Trigger 3D generation
- `GET /api/caves/{id}/mesh/` - Download mesh
- `GET /api/caves/{id}/viewer/` - 3D viewer URL

---

## Synchronization Strategy

### Device → Backend (Push)

When device connects to WiFi:

1. **Establish Connection**
   - Device authenticates with token
   - `POST /api/sync/start/` creates `SyncSession`

2. **Compare Deltas**
   - Device sends last sync timestamp
   - Backend returns list of changed records

3. **Push New Data**
   - Device uploads new caves, POIs, photos
   - PCD files uploaded to S3
   - Metadata saved to PostgreSQL
   - `POST /api/sync/push/` with batch data

4. **Receive Updates**
   - Backend sends requested maps (user selected for download)
   - Backend sends updates to existing caves (comments, edits)
   - Device pulls via `GET /api/sync/pull/`

5. **Finalize**
   - `POST /api/sync/complete/` marks sync successful
   - Update `Device.last_sync_at`

### Conflict Resolution

**Case 1: Two devices map same cave**
- Each creates separate `Cave` entry with unique UUID
- Maps stored as separate expeditions under same physical cave
- Future: UI for merging/stitching

**Case 2: Concurrent edits to cave description**
- Wiki-style version control
- All edits saved as `DescriptionRevision`
- Latest revision is "current"
- Users can view/revert history

---

## Permission System

### Cave Visibility Levels

1. **Public**
   - Visible to all users
   - GPS coordinates shown
   - Editable based on collaboration setting

2. **Limited Public**
   - Visible to all users
   - GPS coordinates HIDDEN
   - Location description vague
   - Protects sensitive cave locations

3. **Unlisted**
   - Hidden from search/explore for all users except owner (and future group members)
   - API: `cave_list` filters by visibility using `Q` objects (public/limited_public + owner's own)
   - Coordinate proximity check at creation warns about nearby existing caves to prevent unknowing duplicates

4. **Private**
   - Only visible to owner and shared users
   - Shareable via QR code or URL
   - Share links can be revoked

### User Roles

1. **Owner**
   - Full access (delete, edit, share, download)
   - Only owner or admin can delete cave

2. **Editor**
   - Edit cave data, add POIs, upload photos
   - Cannot delete or change permissions
   - Can download to device

3. **Viewer**
   - Read-only access
   - Can comment
   - Can download to device (if permitted)

### Collaboration Settings

- **Read-Only**: Users can view, comment, download
- **Collaborative**: Users can edit descriptions, add photos, create POIs

---

## 3D Processing Pipeline (Post-MVP)

### Input
- PCD files from FAST-LIO SLAM
- Keyframe JSON files with poses
- RGB images from 3x cameras (forward, upper-left, upper-right)
- Environmental sensor data (gas, particulates)

### Processing Steps

1. **Point Cloud Cleaning**
   - Remove outliers
   - Downsample for performance
   - Segment floor/walls/ceiling

2. **Mesh Generation**
   - Poisson surface reconstruction
   - Marching cubes
   - Or: Gaussian splatting for photorealism
   - Target: Lightweight mesh for game engine

3. **Texture Mapping**
   - Project camera images onto mesh
   - Blend overlapping textures
   - Apply environmental hues (red tinge for toxic gas zones)

4. **Optimization**
   - LOD (Level of Detail) generation
   - Occlusion culling
   - Texture atlas creation

5. **Export**
   - GLB/GLTF format for web
   - Separate LOD levels
   - Metadata for game engine

### Libraries (TBD)
- Open3D (Python point cloud processing)
- PyTorch3D (differentiable rendering)
- CloudCompare (command-line batch processing)
- Custom CUDA kernels for GPU acceleration

---

## Game Engine Integration (Post-MVP)

### Requirements
- Browser-based (WebGL/WebGPU)
- Mobile and desktop support
- First-person navigation
- Touch controls + keyboard/mouse
- Fog-of-war loading (only render visible sections)
- Performance throttling based on FPS

### Candidate Engines
1. **Three.js** - Lightweight, mature, huge community
2. **Babylon.js** - Optimized for games, good docs
3. **Unity (WebGL export)** - Full game engine, larger bundle
4. **Unreal Engine (Pixel Streaming)** - Server-side rendering
5. **Godot (Web export)** - Open source, smaller footprint

**Decision Criteria**: Bundle size, mobile performance, ease of integration

---

## Map Stitching (Future)

### Use Case
Multiple expedition sessions mapping different sections of the same cave need to be merged into a single coherent map.

### Automated Approach
1. Detect overlapping regions using ScanContext or similar
2. Run ICP (Iterative Closest Point) for alignment
3. Merge point clouds with overlap subtraction
4. Regenerate unified mesh

### Manual UI Approach
1. Load two point clouds side-by-side
2. User drags/rotates one cloud to align
3. Visual feedback:
   - Green points (map 1) + Red points (map 2)
   - Overlapping points turn blue
   - Fully blue = perfect alignment
4. Automatic fine-tuning after manual coarse alignment

---

## Mobile vs Desktop Capabilities

### Mobile
- View caves (list, detail, 3D exploration if device supports)
- Add comments, upload photos
- Basic edits (cave description, POIs)
- Download maps to device
- **Cannot**: Stitch maps, upload PCD files

### Desktop
- Full mobile capabilities
- Map stitching UI
- Upload PCD files directly
- Advanced 3D editing tools
- Performance settings for rendering

---

## Deployment

See **[DEPLOY.md](DEPLOY.md)** for full deployment guide, step-by-step setup, and lessons learned.

### Local Development
- Windows 10 PC with WSL2
- NVIDIA RTX 4090 GPU
- Django dev server + React dev server (Vite)
- SQLite (dev) / PostgreSQL (prod)
- Cloudflare Quick Tunnel (`cloudflared`) for remote/mobile testing — `~/.local/bin/cloudflared tunnel --url http://localhost:5174`

### Production (Live)
- **URL**: `https://cavedragon.llc`
- **Server**: Hetzner CPX11 (2 vCPU, 2 GB RAM + 2 GB swap, 40 GB SSD) — `178.156.149.31`
- **PaaS**: Dokku (self-hosted, git-push deploys)
- **ASGI**: Daphne (HTTP + WebSocket via single process)
- **Database**: PostgreSQL 14 (Dokku plugin)
- **Cache/PubSub**: Redis 7 (Dokku plugin, used by Django Channels)
- **Object Storage**: Cloudflare R2 (S3-compatible, zero egress)
- **DNS/CDN**: Cloudflare (proxied A records, Full Strict SSL)
- **SSL**: Let's Encrypt (Dokku plugin, auto-renewal cron)
- **Static Files**: WhiteNoise (serves Vite-built frontend + Django staticfiles)

### Deploy Workflow
```bash
git push origin main    # GitHub backup
git push dokku main     # Deploy (~2-3 min)
# If migrations needed:
ssh root@178.156.149.31 "dokku run cave-backend python manage.py migrate"
```

### Deployment Files
| File | Purpose |
|------|---------|
| `Procfile` | Web process: Daphne ASGI server |
| `.buildpacks` | Multi-buildpack: Node.js → Python |
| `package.json` (root) | `heroku-postbuild` builds frontend |
| `runtime.txt` | Python 3.12.8 |
| `.slugignore` | Excludes source/docs from slug |
| `frontend/.npmrc` | `legacy-peer-deps=true` for React 19 |

---

## Development Roadmap

### Phase 1: MVP - Sync + Basic Social (Current Priority)

**Goals**:
- Users can create accounts (Google OAuth)
- Devices can register and authenticate
- cave-server can sync with cave-backend
- Users can browse public caves
- Users can comment and upload photos

**Tasks**:
1. Django project setup
2. User authentication (Google OAuth)
3. Database models (User, Device, Cave, Comment)
4. REST API endpoints (auth, caves, sync)
5. Device registration flow (QR code)
6. Sync mechanism implementation
7. Basic React frontend (cave list, detail)
8. S3 integration for file uploads

**Timeline**: TBD (to be discussed in dev sessions)

### Phase 2: Advanced Social Features

**Goals**:
- Activity feeds
- User profiles with stats
- Follow/unfollow users
- Ratings and reviews
- Wiki-style editing with history

### Phase 3: 3D Processing

**Goals**:
- PCD → mesh generation pipeline
- Texture mapping from camera images
- GPU-accelerated processing (Celery tasks)
- 3D file storage and serving

### Phase 4: Virtual Exploration

**Goals**:
- Browser-based 3D cave exploration
- Game engine integration
- Mobile and desktop support
- Performance optimization

### Phase 5: Map Stitching

**Goals**:
- Automated map alignment
- Manual stitching UI
- Multi-expedition merging
- Version control for maps

---

## Critical Considerations

### Security
- Device tokens must be secure and revocable
- S3 pre-signed URLs for file access
- Rate limiting on API endpoints
- Input validation for all uploads
- CSRF protection for web app

### Performance
- PCD files can be 2GB+ per cave
- S3 multipart uploads for large files
- Background processing for 3D generation (Celery)
- CDN for static assets
- Database indexing on foreign keys

### Scalability
- Horizontal scaling for web servers (stateless)
- GPU workers for 3D processing (queue-based)
- Database read replicas for high traffic
- Object storage for unlimited file growth

---

## Known Challenges

1. **PCD File Size**: Caves average 2GB+ (PCD + photos)
   - Solution: S3 storage, resume-capable uploads

2. **3D Processing Time**: Mesh generation can take minutes/hours
   - Solution: Celery task queue, progress tracking, email notification

3. **Conflict Resolution**: Two devices mapping same cave
   - Solution: Treat as separate expeditions, merge later

4. **GPS Privacy**: Limited Public caves hide coordinates
   - Solution: Database query filter, API enforcement

5. **Mobile 3D Performance**: Large meshes may lag on phones
   - Solution: LOD levels, fog-of-war loading, performance settings

---

## Testing Strategy

### Unit Tests
- Django models and serializers
- API endpoint logic
- Sync algorithm correctness

### Integration Tests
- Sync flow end-to-end
- Authentication flow
- File upload/download

### Load Tests
- Concurrent sync sessions
- Large PCD file uploads
- 3D viewer performance

### Manual Testing
- Device registration flow
- cave-server → cave-backend sync
- QR code scanning
- 3D exploration on mobile/desktop

---

## Documentation Structure

This project includes:
- `CLAUDE.md` (this file) - AI continuity document
- `README.md` - Project overview for humans
- `ARCHITECTURE.md` - System design deep-dive
- `MVP_PLAN.md` - Phase 1 development plan
- `DATABASE_SCHEMA.md` - Database design
- `API_SPEC.md` - REST API specification
- `DEPLOY.md` - Production deployment guide (Hetzner/Dokku/R2/Cloudflare)

---

## Notes for AI Assistants

- **cave-server relationship**: cave-backend is the cloud twin of cave-server. They share database schema but serve different purposes (local vs cloud).
- **MVP focus**: Do not start 3D processing until sync and social features are complete.
- **cave-mapper integration**: cave-mapper (ROS2 hardware) → cave-server (device Django) → cave-backend (cloud Django). cave-mapper does NOT talk directly to cave-backend.
- **GPU requirement**: 3D processing requires NVIDIA GPU (CUDA). Initial dev on RTX 4090.
- **OAuth**: Use django-allauth for Google OAuth integration.
- **Storage**: Use S3-compatible storage from day one (boto3). Don't store files in database.
- **Permissions**: Enforce at API level AND database query level. Never expose private caves in listings.

---

## Current Session Context

**Date**: 2026-02-27
**Status**: Active development — core features operational

### What's Built

**Backend (Django)**:
- Full Cave CRUD with UUID primary keys, visibility levels (public/limited_public/unlisted/private), collaboration settings
- Permission enforcement on edit/delete: owner or `is_staff` only (401/403 responses)
- LandOwner model with TN GIS parcel integration (ArcGIS + TPAD API)
- PAD-US public land lookup: 4 fields on Cave model (`public_land_name/type/owner/access`), auto-lookup on create, manual button, backfill command
  - `caves/padus_lookup.py`: USGS PAD-US 4.1 ArcGIS FeatureServer, point-in-polygon, best-feature selection, retry with backoff
  - `N/A` sentinel for caves confirmed not on public land (backfill skip logic)
  - Green badge on CaveDetail + Explore cards, "Public Land" filter on Explore page
- Three-tier GIS data visibility: always-visible (TPAD link, polygon, GIS Map), mutable (owner name, address, acreage), hidden (contact info)
- `gis_fields_visible` toggle on LandOwner — cave entry creator controls tier-2 field visibility
- CaveRequest model with accept/deny lifecycle for contact access requests and contact info submissions
- `contact_access_users` M2M on LandOwner for granular per-user contact visibility grants
- User auth with registration, login, JWT tokens, invite-code-gated signups
- Social features: comments, ratings/reviews, wiki-style descriptions with revision history, user wall posts
- Media ownership system: photos, documents, video links belong to uploader (SET_NULL on cave FK)
- `MediaVisibility` choices (public/unlisted/private) on all media models
- `cave_name_cache` on media and posts — preserves cave name after cave deletion
- `uploaded_by` FK on CavePhoto — tracks who uploaded each photo
- User media gallery endpoint — aggregates cave photos + post images + documents + video links
- Media visibility control endpoint — users can set their media to public/unlisted/private
- Post soft delete: `is_deleted` + `deleted_at` — preserves conversation when comments exist, hard deletes otherwise
- Post `cave_status` computed field: active/unlisted/deleted based on cave FK state
- Comments blocked on soft-deleted posts (403)
- Photo upload with caption/tags, camera capture
- SurveyMap model with CRUD API — multi-survey overlays per cave with persistent calibration (anchor, scale, heading, opacity, lock state)
- Survey map image processing pipeline (background removal + recolor via `caves/hand_drawn_map.py`)
- CaveDocument model — PDF upload with file size tracking, optional page count (PyPDF2)
- CaveVideoLink model — URL-based video links with auto-detection of platform (YouTube, Vimeo, TikTok, Facebook), embed URL, and thumbnail generation
- Video URL parser (`caves/video_utils.py`) — regex-based platform detection, video ID extraction, embed/thumbnail URL generation
- Cave routing system with A* pathfinding
- Device management and sync infrastructure
- Bulk import: CLI management command + admin-only web UI with two-phase flow (preview + apply)
  - File formats: CSV (UTF-8/Windows-1252), Excel (.xlsx via openpyxl), KML, KMZ (Google Earth)
  - URL import: paste a Google Maps shared list link, auto-fetches places via internal API
  - `caves/kml_import.py`: KML/KMZ parsing (stdlib xml.etree + zipfile), Google Maps list fetcher
  - `caves/excel_import.py`: Excel parsing with openpyxl (read_only + data_only)
- Coordinate-based duplicate detection (Haversine distance) with conflict resolution (keep/replace/rename)
- Intra-CSV duplicate detection: name matching (O(n) grouping) + coordinate proximity (latitude-sorted banding), bidirectional flagging with match_type upgrade
- Approximate coordinates: `coordinates_approximate` BooleanField on Cave, keyword detection in CSV imports ("approximate", "approx", "~", "estimated"), modified conflict logic (approx+approx skips proximity)
- Multi-entrance CSV import: semicolon-separated coordinate pairs in lat/lon columns, first pair = primary entrance, subsequent pairs → entrance POIs (`PointOfInterest` with `poi_type='entrance'`)
- Universal coordinate parser (decimal, DMS, UTM, MGRS, Google/Apple Maps URLs)
- Google Maps short URL resolver (server-side redirect following)
- Reverse geocode endpoint (Nominatim) — auto-fills city, state, country, zip from coordinates
- Proximity check endpoint — warns about existing caves within ~50m at creation time
- Nearby caves endpoint (`GET /api/caves/{id}/nearby/`) — 300m proximity search with Haversine distance, visibility filtering, `has_survey` annotation
- Visibility-filtered `cave_list` API — unlisted/private caves hidden from non-owners
- Title case auto-normalization for cave names and aliases on save
- `is_staff` exposed via UserProfileSerializer for frontend admin gating
- Traditional cave survey system (`survey/` app): CaveSurvey, SurveyStation, SurveyShot models
- Survey compute engine: polar→cartesian conversion, BFS station positioning, proportional loop closure, LRUD→passage wall generation
- Survey API: CRUD + bulk shot create (auto-creates stations) + compute + render endpoints
- Feet/meters unit support with automatic conversion to meters for computation
- Survey OCR: GOT-OCR 2.0 (`stepfun-ai/GOT-OCR-2.0-hf`) for handwritten survey sheet recognition
  - `survey/ocr.py`: lazy model loading, markdown table + plain text parsers, LaTeX stripping, repetition trimming
  - OCR number correction (D/O/Q→0, O→0, l→1), fuzzy column header matching
  - Expected row count hint from frontend caps `max_new_tokens` to prevent hallucination
- SLAM-to-survey generation (`survey/slam_survey.py`): converts SLAM map data into traditional survey format
  - `select_stations()`: filters trajectory points by minimum spacing
  - `cast_ray()` + `_ray_segment_intersect()`: 2D raycasting against wall polylines for L/R passage dimensions
  - `raycast_lrud()`: perpendicular raycasts for LRUD, U/D derived from level z_range
  - `detect_leads()` + `_find_void_gap()`: trailing-window void detection for side passage openings
  - `generate_slam_survey_data()`: single-level entry point
  - `generate_merged_slam_survey()`: multi-level merged survey with level-prefixed stations (L1-S1, L2-S1) and transition connecting shots
  - `source` field on CaveSurvey (manual/slam) distinguishes hand-entered from generated surveys
  - API: `POST /api/caves/{id}/generate-slam-survey/` — level='all' (default) merges all levels, level=0/1/... for single level; auto-computes render_data after creation
- Real-time chat system (Phases 1-4 — Discord-style DMs + channels + message management)
  - Django Channels 4.x + Redis channel layer + Daphne ASGI server
  - Single WebSocket per user multiplexed across all channels via Redis groups
  - `ChatConsumer(AsyncJsonWebsocketConsumer)` handles chat.message, chat.mark_read, chat.join_channel + broadcasts edit/delete/pin/notification
  - Personal `user_{id}` WS group for targeted notification delivery
  - JWT WebSocket auth via `?token=` query string (`chat/middleware.py`)
  - Unified channel model: DMs are channels with `channel_type='dm'` and exactly 2 members
  - Read cursors: `last_read_message_id` on ChannelMembership for unread tracking
  - Message edit (PATCH, author only) with `edited_at` timestamp, re-parses mentions + video preview
  - Message soft delete (DELETE, author or channel owner) — clears content/attachments, `is_deleted` + `deleted_at`
  - Flat reply threading — `reply_to` self-FK, one level only (replies to replies rejected)
  - Message pinning — toggle `is_pinned`, pinned messages list endpoint, pin notification to author
  - @mentions — regex `@(\w+)` parsing, `MessageMention` model, notifications for mentioned channel members
  - Notification system — `Notification` model (mention/reply/pin types), REST CRUD, WS delivery via personal group
  - `allow_dms` BooleanField on UserProfile — enforced in `dm_get_or_create` (403 if disabled)
  - Batch-loading helpers: `_inject_reaction_summaries`, `_inject_reply_counts`, `_inject_mentions` (2-query N+1 avoidance)
  - Message search: `content__icontains` across user's channels, optional channel filter, limit 50
  - 20+ REST endpoints + user search + cursor-paginated message history
  - User search endpoint: `GET /api/users/search/?q=<query>` (min 1 char, excludes self)
- Events system (Phase 1 + Phase 2 integrations — calendar-driven community events)
  - `events/` Django app: Event, EventRSVP, EventInvitation, EventComment models
  - 8 event types (expedition, survey, training, education, outreach, conservation, social, other)
  - 5 visibility levels (public, all_grotto, grotto_only, unlisted, private)
  - Location: optional cave FK + lat/lon + address + Google Maps link + meetup_instructions
  - RSVP with capacity check (409 when full), going/not_going (maybe removed from UI)
  - Capacity UX: Going button replaced with "Full" badge when at capacity, re-enables when spots open
  - Invitations target user XOR grotto (CheckConstraint), pending/accepted/declined lifecycle
  - Visibility filtering via `_get_visible_events()` helper with grotto membership + invitation Q objects
  - Chat integration: auto-creates channel on event creation ("{name} (event)"), auto-joins on RSVP going, first message with event link pill, event deletion cascades to chat channel
  - Wall post integration: `event` FK + `event_name_cache` on Post model, inline event pill + cave pill rendering ("Created event [pill] at [cave pill]")
  - 16 REST endpoints at `/api/events/` including user-events endpoint

**Frontend (React/Vite)**:
- Cyberpunk-themed UI with dark mode, "Cave Dragon" branding, Ubuntu font (Google Fonts), cyan dragon logo
- Explore page with searchable cave list + surface map + sort/filter (stars, mapped, unmapped, public land, needs details, activity)
  - Search by name, city, state, zip code, aliases
  - Admin-only bulk import modal (CSV/Excel/KML/KMZ file upload + Google Maps URL paste, proximity duplicate detection, intra-file duplicate detection, conflict resolution UI, approx badges)
  - Marker clustering (leaflet.markercluster) with cyberpunk-themed cluster icons (red when all children are approximate)
  - Reactive marker updates (no map destruction on search) with smart fitBounds (skips when lat span > 50° to avoid intercontinental zoom-out from 5 international caves)
  - Default US center [39.8, -98.6] with zoom 5; single search result auto-centers via mapCenter
  - sessionStorage persistence: map position (center/zoom) + cave data cached for instant restore on back-navigation
  - Instant map load: tiles render immediately (no loading gate), cached markers show instantly, fresh API data replaces in background
  - Smart fitBounds: skips on initial mount when restoring saved view, runs on search/filter changes
  - Cave cards show aliases in parentheses after name
- Cave detail page with:
  - Unified cave detail canvas (CaveMapCanvas): shows SLAM LiDAR scans and/or traditional survey data as toggleable layers in a single canvas
    - Three modes: SLAM-only, survey-only, combined (SLAM + survey)
    - Survey rendering extracted to `surveyCanvasRenderers.js` — 8 draw functions in world coordinates
    - Survey-only mode: grid, north arrow, scale bar, branch legend, symbol legend, passage walls, centerline, stations
    - Combined mode: survey layers drawn between SLAM trajectory and POIs, survey toggle button in toolbar
    - Offscreen canvas compositing for uniform alpha passage wall fills
    - Combined bounding box calculation (`combineBounds`) for fitToView across both datasets
  - 3D cave explorer (Three.js point cloud viewer)
  - Multi-entrance support: entrance POIs with GPS coordinates, green markers on surface map, entrance management UI (add/delete), multi-point SLAM registration (2D similarity transform from 2+ GPS+SLAM entrance pairs), coordinate change cascades delta to all entrance POIs
  - Surface map with Leaflet (cave markers, parcel polygon overlay, cave map overlay, survey map overlays, entrance markers (green), nearby cave markers (purple), center-on-cave button, zoom to level 21, multi-layer tile switcher, 3DEP LiDAR hillshade overlay, map tools toolbar, coordinate readout)
  - GPS "My Location" button on all map viewports (Explore, CaveDetail, FineTuneMapModal, EventDetail): browser Geolocation API, pulsing blue dot + accuracy ring, real-time position tracking, toggle between user location and cave/home center
  - Surface map tools (MapToolbar): Measure (click-two-points distance/bearing with copy), Waypoint (click-to-place POIs), Polygon (draw/label/area), Elevation Profile (3DEP terrain cross-section with canvas chart). Tier 1 (Measure + CoordReadout) on both Explore + CaveDetail maps; Tier 2 (Waypoint/Polygon/Elevation) on CaveDetail only
  - Unified SurveyLayerPanel on surface map: collapsible "Surveys (N)" button lists both computed survey overlays and scanned survey images with independent per-layer toggles, replaces old separate buttons
  - Nearby caves on surface map: purple markers (300m radius), popup with distance + link + "Toggle Survey" button, lazy-loaded muted purple survey overlays from neighboring caves
  - Survey map overlay system: adaptive ingestion modal — two-point auto-calibration (pin 2 known entrances → auto-compute scale + heading) when 2+ GPS entrances exist, falls back to classic 4-step flow (upload → pin entrance → set scale → orient & confirm); per-image toggle via SurveyLayerPanel, edit/delete, rotation-aware auto-fit
  - Google Earth-style floating collapsible panel on surface map with mode selector, level selector, opacity control
  - CaveMapOverlay supports all 7 modes: walls (quick/standard/detailed/raw_slice), edges (amber), heatmap (inferno colormap image), points (density circles)
  - CaveMapSection: unified toolbar with Survey toggle (amber), collapsible Routes & POIs panel (two-column grid, collapsed by default)
  - Tabbed Media section (Photos / Documents / Videos) replacing standalone photo gallery
  - Photo tab: gallery with carousel, upload dialog, camera capture
  - Documents tab: PDF upload with drag-and-drop, in-app PDF viewer (blob URL + iframe), delete
  - Videos tab: URL-based video links with auto platform detection, thumbnail grid with play overlay, full-screen embedded playback (YouTube/Vimeo/TikTok), fallback to external link for unsupported platforms
  - Wiki description editor with rich text (TipTap)
  - Star ratings and reviews
  - Property owner section with GIS lookup, visibility toggle, contact info tiers
  - CaveRequest system: request contact access, submit contact info, pending requests with accept/deny for cave owners
  - Inline coordinate editor (accepts any format, approximate checkbox, Fine Tune click-on-map modal with satellite + 3DEP hillshade)
  - Inline alias editor for cave owners/admins
  - Edit and Delete buttons in topbar (owner or admin only)
  - Delete confirmation modal with permanent deletion warning
  - Unlisted visibility badge (purple)
  - Traditional survey section: spreadsheet-style shot entry (azimuth/distance/inclination/LRUD), SurveyOverlay (Leaflet layer for surface map), survey list with create/delete
  - Underpass dashed rendering: multi-level surveys detect vertical levels (z-gap > 1.5m), lower-level passages rendered with dashed outlines and dimmed fill, lower station labels hidden, dense survey label thinning (>20 stations)
  - Continuous passage outline polygons: per-branch smoothed-bearing wall projection (left/right walls as separate polylines), flat caps at dead ends, hybrid approach with per-shot quads for loop closure shots
  - NSS cave cartography symbols: 62 SVG icons across 10 categories, keyword-matched from shot comments, rendered at shot midpoints on both Canvas and Leaflet overlays, auto-legend showing only used symbols
  - Survey OCR: "Scan Sheet" button opens SurveyOCRModal — photograph handwritten survey form, GOT-OCR 2.0 extracts shots, editable review table with ◀▶ cell shift buttons for fixing column alignment, row count hint dropdown
  - "Generate from Map" button (magenta) in SurveyManager: appears when cave has SLAM map data and no SLAM-generated survey exists; generates traditional survey from SLAM data via API, SLAM badge on generated surveys
  - Page layout order: Cave Map → Surveys → Equipment → Description → Surface Map → Media → Ratings → Comments
- Create Cave page with smart coordinate input, reverse geocode auto-fill (city/state/country/zip), proximity duplicate warning (~50m), approximate checkbox with softer warning, aliases, unlisted visibility option, Fine Tune / Pick on Map modal
- User profile page with avatar presets, saved routes, media gallery
  - Media tab with sub-tabs: Photos (grid), Documents (list), Videos (grid)
  - Aggregates cave photos + wall post images into unified photo gallery
  - Cave status badges: cyan link (active), red badge (deleted cave), dim (no cave)
  - Visibility badges on non-public items
- Login/Register pages
- Social feed with post composer
  - Post soft delete: "[Deleted by author]" placeholder preserves comment threads
  - Cave status badges on posts: active (link), unlisted (dim), deleted (red with cached name)
  - Reaction bar hidden on deleted posts; comment toggle preserved if comments exist
- Chat page (Discord-style real-time messaging)
  - ChatPage: full-height 3-panel layout (sidebar + messages + header), mobile responsive (sidebar OR messages)
  - ChatSidebar: grouped Channels/DMs sections, unread badges (magenta), last message preview, time ago
  - ChatMessages: REST-fetched history, infinite scroll up for older messages, auto-scroll to bottom, message grouping by author (5min window), date separators, mark-read on view, bubble-style layout (user messages right-aligned with cyan tint, others left-aligned)
  - Emoji reactions: hover smiley → lazy-loaded `@emoji-mart/react` picker (portaled to body), toggle via WS, reaction pills with counts, cyan highlight for own reactions, reactor username tooltips on hover, batch-loaded history (2-query aggregation, no N+1)
  - Video embeds: server-side `video_preview` extraction on save (reuses `caves/video_utils.py`), client-side fallback parsing for pre-migration messages, thumbnail with play overlay + platform badge, click-to-expand inline iframe (16:9 YT/Vimeo, 9:16 TikTok)
  - Hover action bar: 5 buttons (React, Reply, Pin, Edit, Delete) — Edit for own msgs, Delete for own or channel owner
  - Inline message editing: textarea with Enter=save, Escape=cancel, "(edited)" label after content
  - Soft delete: "[This message was deleted]" placeholder, no hover actions
  - Flat reply threading: reply-to preview bar above bubble (clickable scroll-to-parent), reply count button, reply bar in composer ("Replying to @username")
  - Pinned messages: pin indicator below messages, "Pinned N" button in header opens right sidebar panel with scrollable list
  - @mentions: MentionAutocomplete portaled dropdown (debounced search, keyboard nav), mention highlighting in cyan
  - Clickable usernames: open UserPreviewPopover (portaled card with avatar, bio, View Profile + Send DM buttons)
  - Message highlight animation: `scrollToMessage` with 2s cyan flash CSS keyframes
  - ChatComposer: auto-resize textarea, Enter to send, Shift+Enter newline, emoji picker button (inserts at cursor), file/image attachment with paste support, @mention detection + autocomplete, reply_to in send payload
  - NewDMModal: user search (1+ chars) → create DM
  - NewChannelModal: name + description form → create channel
  - WebSocket singleton (chatSocket.js): auto-reconnect with exponential backoff (1s→30s), close code 4001 = auth failure (no reconnect)
  - Zustand chatStore: channels, messages cache, unread counts, incoming message handling, Phase 4 handlers (edit/delete/pin/notification), search, pinned messages cache, notifications state
  - TopBar: Chat nav with magenta unread badge, 60s polling via fetchUnreadCount when not on chat page
- Public user profile page (`/users/:userId`): avatar, bio, stats (caves/mapped/expeditions), specialties, tabs (wall/media/ratings), Send DM button (respects allow_dms), redirects to `/profile` for self
- UserPreviewPopover: portaled card on username click in chat, View Profile + Send DM buttons
- Profile page: added allow_dms toggle (switch UI in edit panel)
- Events page (FullCalendar React + event cards + type filters)
  - FullCalendar month view + list view with cyberpunk CSS overrides, color-coded by event type
  - Type filter pill buttons filter both calendar and event cards
  - Event cards sorted soonest first with type badge, date, location, RSVP count, capacity-aware Going button
  - EventCreateModal: cave search picker, grotto checkbox, RichTextEditor description, date pickers, visibility dropdown, meetup instructions
  - EventDetail page: dark CartoDB map with zoom/center controls, RSVP buttons (going/not going), attendee list with AvatarDisplay + profile links, chat channel link, meetup instructions, description, equipment, comments, invite button
  - EventInviteModal: user search + grotto tabs for private event invitations
  - EventComments: comment list + composer
  - Route `/events` (replaces `/expeditions`), `/events/:eventId` (lazy-loaded)
  - TopBar nav: "Expeditions" renamed to "Events"
  - Profile.jsx: "My Events" tab; UserProfilePage.jsx: "Events" tab
  - PostCard.jsx: inline event pill rendering with color-coded capsule + cave pill ("Created event [pill] at [cave]")
  - ChatMessages.jsx: `[event:/events/{id}|{name}]` token rendered as clickable event pills
- 3D Point Cloud Editor (`/editor` or `/editor/:caveId`) — map stitching tool (Phases 1-3 complete)
  - Quad-viewport layout: Top (XZ), Free Camera, Front (XY), Profile (ZY) with resizable dividers
  - Single WebGL renderer with scissor test, 4 cameras per frame
  - Multi-format import: GLB, PLY, PCD via Three.js loaders (file upload + cross-cave import)
  - TransformControls gizmo in all 4 viewports (translate/rotate/scale, T/R/S keys)
  - Cloud panel: per-cloud visibility, color tinting, lock, delete
  - 6DOF fly mode (G key): WASD movement, mouse look (`cam.rotateY/X`), Q/E roll, Space/Shift up/down
  - Alignment mode (A key): Pick tool (P), point pair picking across all viewports, N-point Procrustes registration (≥3 pairs), ICP fine-tuning with adjustable sample size, overlap proximity visualization (KD-tree distance coloring)
  - AlignmentPanel sidebar: source/target cloud selectors, control point list, registration with RMSE, ICP progress bar, overlap colors toggle, accept/reset
  - Pure math module (`alignmentMath.js`): 3x3 SVD (Jacobi), Procrustes, KD-tree, ICP — zero Three.js dependencies
  - Pick markers: green spheres (source), red spheres (target), yellow connecting lines (`depthTest: false`)
  - Zustand store (`editorStore.js`) for all state
  - Route `/editor`, `/editor/:caveId` (lazy-loaded)

**GIS Integration (Tennessee)**:
- Statewide COMPTROLLER_OLG_LANDUSE ArcGIS service (86/95 counties)
- County-specific ArcGIS services (Davidson/Nashville)
- TPAD API for owner name, property class, sale date, GIS map link
- Parcel boundary polygon rendering on Leaflet maps
- Property type code interpretation (13 TN codes mapped)
- Auto-fill on GIS Lookup, auto-clear on coordinate change

**Data**:
- 14 Tennessee caves seeded from historical survey data
- Seed data command + CSV import tool (CLI + web UI)
- taco_dragon user has is_staff=True for admin features

### Key Files

| File | Purpose |
|------|---------|
| `caves/csv_import.py` | Shared CSV parsing + Haversine duplicate detection + intra-CSV dedup + approximate coordinate handling |
| `caves/kml_import.py` | KML/KMZ parsing (xml.etree + zipfile) + Google Maps list URL fetcher |
| `caves/excel_import.py` | Excel (.xlsx) parsing with openpyxl |
| `caves/gis_lookup.py` | TN GIS parcel lookup (ArcGIS + TPAD) |
| `caves/padus_lookup.py` | PAD-US public land lookup (USGS ArcGIS FeatureServer, point-in-polygon, best-feature selection) |
| `caves/hand_drawn_map.py` | Survey map image processing (bg removal + recolor) |
| `caves/models.py` | Cave (coordinates_approximate), LandOwner, CavePhoto (SET_NULL + uploaded_by), DescriptionRevision, CavePermission, CaveShareLink, CaveRequest, SurveyMap, CaveDocument (SET_NULL), CaveVideoLink (SET_NULL), MediaVisibility, SurfaceAnnotation (polygon overlays) |
| `caves/video_utils.py` | Video URL parser (platform detect, embed URL, thumbnail generation) |
| `caves/serializers.py` | Full/Public/Muted serializers with tier-based redaction + CaveRequestSerializer + SurveyMapSerializer + CaveDocumentSerializer + CaveVideoLinkSerializer |
| `caves/views.py` | Cave CRUD (owner/admin perms), GIS lookup, reverse geocode, proximity check, nearby caves, map data, photo upload, request lifecycle, CSV import, survey map CRUD, document upload, video link CRUD, user_media + user_media_update |
| `frontend/src/pages/CaveDetail.jsx` | Main cave profile page (~1800 lines) |
| `frontend/src/utils/slamTransform.js` | Multi-point SLAM-to-GPS registration: similarity transform solver, converter factory, backward-compat `slamToLatLng` |
| `frontend/src/components/CaveMapOverlay.jsx` | SLAM-to-LatLng overlay on Leaflet (all 7 modes), accepts external `converter` prop |
| `frontend/src/components/FineTuneMapModal.jsx` | Click-to-pick Leaflet modal for coordinate refinement (satellite + 3DEP hillshade, layer switcher) |
| `frontend/src/components/SurfaceMap.jsx` | Leaflet map with reactive markers (cyan/red approximate), clustering (red when all approx), entrance markers (green), nearby cave markers (purple), parcel polygon, cave overlay, survey overlays, center button, SurveyLayerPanel, MapToolbar |
| `frontend/src/components/HandDrawnMapOverlay.jsx` | Multi-survey Leaflet image overlays with per-image visibility (visibleImageIds Set), lock/edit mode |
| `frontend/src/components/SurveyLayerPanel.jsx` | Unified survey layer selector — lists computed surveys + scanned images with independent toggles |
| `frontend/src/components/maptools/MapToolbar.jsx` | Map tool toolbar — Measure, Waypoint, Polygon, Elevation tools with active-tool state |
| `frontend/src/components/maptools/MeasureTool.jsx` | Click-two-points distance/bearing measurement with copy |
| `frontend/src/components/maptools/CoordReadout.jsx` | Cursor lat/lon display at bottom-center of map |
| `frontend/src/components/maptools/WaypointTool.jsx` | Click-to-place surface waypoints (POI API) |
| `frontend/src/components/maptools/PolygonTool.jsx` | Draw labeled polygons with color + area calculation |
| `frontend/src/components/maptools/ElevationProfile.jsx` | Two-point terrain cross-section (USGS 3DEP, canvas chart) |
| `frontend/src/components/maptools/MyLocationButton.jsx` | GPS location button — browser geolocation, pulsing blue dot, accuracy ring, toggle between user/cave |
| `frontend/src/utils/geoUtils.js` | Shared haversine, bearing, polygon area, distance formatting, point interpolation |
| `frontend/src/utils/elevationApi.js` | USGS 3DEP getSamples API wrapper for elevation queries |
| `frontend/src/components/SurveyMapModal.jsx` | Adaptive survey map ingestion: two-point auto-calibration (2+ entrances) or classic 4-step flow |
| `frontend/src/components/DocumentUploadModal.jsx` | PDF upload dialog with drag-and-drop |
| `frontend/src/components/DocumentViewer.jsx` | Full-screen PDF viewer (blob URL + iframe) |
| `frontend/src/components/VideoLinkModal.jsx` | Add video URL dialog with platform auto-detect + preview |
| `frontend/src/components/VideoEmbed.jsx` | Full-screen video embed with platform-specific iframe |
| `frontend/src/utils/videoUtils.js` | Client-side video URL parser (mirrors backend) |
| `frontend/src/components/BulkImportModal.jsx` | Three-step admin bulk import modal (file upload or URL paste → preview/resolve → results) |
| `frontend/src/utils/parseCoordinates.js` | Universal coordinate format parser |
| `frontend/src/pages/PointCloudEditor.jsx` | 3D Point Cloud Editor main page — header, toolbar, viewport, conditional panel swap (alignment/cloud) |
| `frontend/src/stores/editorStore.js` | Editor state: clouds, tools, transforms, fly mode, alignment mode, ICP, multi-format import (GLB/PLY/PCD) |
| `frontend/src/components/editor/EditorViewportLayout.jsx` | All Three.js rendering: 4 cameras, scissor test, TransformControls, 6DOF fly mode, pick raycasting, markers, overlap vis |
| `frontend/src/components/editor/EditorToolbar.jsx` | Tool buttons: Select/Pan/Zoom, Translate/Rotate/Scale, Pick Points (P), Fly Mode (G), Fit View (F), Align (A) |
| `frontend/src/components/editor/EditorCloudPanel.jsx` | Right panel: cloud list with visibility/lock/color/delete, Import button |
| `frontend/src/components/editor/AlignmentPanel.jsx` | Alignment sidebar: cloud selectors, point pairs, N-point registration, ICP fine-tune, overlap visualization |
| `frontend/src/components/editor/CloudImportModal.jsx` | Two-tab import: Upload File (GLB/PLY/PCD drag-drop) + From Cave (search caves with 3D maps) |
| `frontend/src/utils/alignmentMath.js` | Pure math: 3x3 SVD (Jacobi), Procrustes rigid registration, KD-tree, ICP, downsample |
| `frontend/src/components/PostCard.jsx` | Wall post card with soft delete, cave status badges, reactions, comments |
| `survey/slam_survey.py` | SLAM-to-survey conversion: station selection, 2D raycasting for LRUD, lead detection, multi-level merging |
| `survey/models.py` | CaveSurvey (source: manual/slam), SurveyStation, SurveyShot models |
| `survey/compute.py` | Polar→cartesian, BFS traversal, loop closure, LRUD→walls, shot_annotations, vertical level detection, passage outline polygons |
| `survey/views.py` | Survey CRUD, bulk shot create, compute + render + OCR + SLAM-to-survey endpoints |
| `survey/ocr.py` | GOT-OCR 2.0 model loading, inference, table parsing, LaTeX stripping |
| `frontend/src/components/SurveyManager.jsx` | Survey list + spreadsheet shot entry table + OCR scan button |
| `frontend/src/components/SurveyOCRModal.jsx` | Two-step OCR modal: upload image → review/edit/shift parsed shots |
| `frontend/src/components/SurveyOverlay.jsx` | Leaflet layer for survey centerline + passage outline polygons + dashed underpass + symbol icons on surface map; `muted` prop for purple nearby cave overlays |
| `frontend/src/utils/surveyCanvasRenderers.js` | Survey drawing functions for CaveMapCanvas (grid, walls, centerline, stations, symbols, legends, north arrow, scale bar) |
| `frontend/src/utils/surveyColors.js` | Shared branch color palette used by CaveMapCanvas, SurveyOverlay, SurveyManager, topology graph |
| `frontend/src/utils/surveySymbols.js` | 62 NSS cave cartography SVG symbols, keyword matching, colorize/dataURL helpers |
| `frontend/src/utils/mapLayers.js` | Tile layer configs (6 base layers + 3DEP hillshade), per-layer CSS filters, localStorage persistence, custom TileLayer for ArcGIS ImageServer |
| `social/views.py` | Wall posts (soft delete + cave_name_cache), ratings, activity feed |
| `users/views.py` | Auth, profile, avatar presets, user search |
| `chat/models.py` | Channel, ChannelMembership, Message (edit/delete/reply/pin fields), MessageReaction, MessageMention, Notification |
| `chat/consumers.py` | ChatConsumer — WS message/read/join/typing/react + broadcast edit/delete/pin/notification, personal user group |
| `chat/middleware.py` | JWTAuthMiddleware — WebSocket JWT auth via query string |
| `chat/views.py` | REST endpoints: channels, messages, DMs, edit/delete/pin, replies, search, notifications (20+ endpoints) |
| `chat/utils.py` | `extract_video_preview()` — reuses `caves/video_utils.py` for URL parsing |
| `chat/routing.py` | WebSocket URL routing (`ws/chat/`) |
| `cave_backend/asgi.py` | ProtocolTypeRouter — HTTP + WebSocket routing with JWT middleware |
| `frontend/src/services/chatSocket.js` | WebSocket singleton with auto-reconnect, pub/sub, sendReaction, sendMessage with reply_to |
| `frontend/src/stores/chatStore.js` | Zustand chat state (channels, messages, unread, reactions, typing, Phase 4: edit/delete/pin/search/notifications/pinned) |
| `frontend/src/pages/ChatPage.jsx` | Main chat page — 3-panel layout, WebSocket lifecycle, routing for edit/delete/pin/notification events |
| `frontend/src/components/ChatSidebar.jsx` | Channel/DM list with unread badges |
| `frontend/src/components/ChatMessages.jsx` | Bubble-style messages, emoji reactions, video embeds, hover action bar (react/reply/pin/edit/delete), inline edit, reply threading, pinned panel, @mention rendering, user popover |
| `frontend/src/components/MentionAutocomplete.jsx` | @mention typeahead dropdown (debounced search, keyboard nav, portaled) |
| `frontend/src/components/UserPreviewPopover.jsx` | User card popover (avatar, bio, View Profile + Send DM, portaled) |
| `frontend/src/pages/UserProfilePage.jsx` | Public user profile page (`/users/:userId`) with stats, tabs, DM button |
| `frontend/src/components/NewDMModal.jsx` | User search + DM creation |
| `frontend/src/components/NewChannelModal.jsx` | Channel creation form |
| `events/models.py` | Event (meetup_instructions, chat_channel FK), EventRSVP, EventInvitation, EventComment models |
| `events/views.py` | Event CRUD, RSVP with capacity check, invitations, comments, calendar, visibility filtering, user-events endpoint |
| `events/serializers.py` | EventSerializer (RSVP counts, user_rsvp, chat_channel), EventCalendarSerializer, RSVP (with avatar_preset), Invitation, Comment serializers |
| `events/urls.py` | 11 URL patterns for events API |
| `frontend/src/pages/Events.jsx` | Main events page with FullCalendar + type filters (filter both calendar + cards) + event cards |
| `frontend/src/pages/EventDetail.jsx` | Event detail with dark CartoDB map, RSVP (capacity-aware), attendees with avatars + profile links, chat link, meetup instructions |
| `frontend/src/components/EventCalendar.jsx` | FullCalendar wrapper with cyberpunk theme, color-coded by event type |
| `frontend/src/components/EventCard.jsx` | Event card with type badge, date, location, capacity-aware Going button / Full badge |
| `frontend/src/components/EventCreateModal.jsx` | Create/edit event modal with cave picker, grotto checkbox, RichTextEditor, meetup instructions |
| `frontend/src/components/EventComments.jsx` | Comment list + composer for events |
| `frontend/src/components/EventInviteModal.jsx` | User/grotto invite modal for private events |

### Migrations (caves app)
- 0001: Initial Cave model
- 0002: Extended initial fields
- 0003: LandOwner model
- 0004: parcel_geometry JSONField
- 0005: TPAD enriched fields (property_class, property_type, last_sale_date, gis_map_link)
- 0006: gis_fields_visible boolean
- 0007: CaveRequest model + contact_access_users M2M on LandOwner
- 0008: SurveyMap model (multi-survey overlays with calibration)
- 0009: CaveDocument + CaveVideoLink models (documents and video links)
- 0010: hazard_count nullable (IntegerField null=True, blank=True)
- 0011: Cave aliases, city, zip_code fields
- 0012: Unlisted visibility choice added
- 0013: Media ownership (SET_NULL on cave FK, uploaded_by, cave_name_cache, MediaVisibility on CavePhoto/CaveDocument/CaveVideoLink)
- 0014: Data migration — backfill cave_name_cache on existing media
- 0015: coordinates_approximate BooleanField on Cave
- 0016: public_land_name, public_land_type, public_land_owner, public_land_access on Cave (PAD-US)
- 0017: SurfaceAnnotation model (polygon overlays on surface map)
- 0018: Increase tpad_link max_length to 500 (PostgreSQL compatibility)

### Migrations (mapping app)
- 0001: Initial PointOfInterest model
- 0002: Add WAYPOINT to PoiType choices

### Migrations (survey app)
- 0001: CaveSurvey, SurveyStation, SurveyShot models
- 0002: render_data JSONField on CaveSurvey
- 0003: source field (manual/slam) on CaveSurvey

### Migrations (social app)
- 0001: Initial social models
- 0002: Post soft delete fields (is_deleted, deleted_at, cave_name_cache)
- 0003: Data migration — backfill cave_name_cache on existing posts
- 0005: event FK (SET_NULL) + event_name_cache on Post model

### Migrations (chat app)
- 0001: Channel, ChannelMembership, Message models
- 0002: is_private field, file attachment fields on Message
- 0003: MessageReaction model, video_preview JSONField on Message
- 0004: Phase 4 — edited_at, is_deleted, deleted_at, reply_to, is_pinned, pinned_by, pinned_at on Message + MessageMention + Notification models

### Migrations (users app)
- 0003: allow_dms BooleanField on UserProfile
- 0004: InviteCode model + invited_by FK on UserProfile

### Migrations (events app)
- 0001: Event, EventRSVP, EventInvitation, EventComment models with indexes and CheckConstraint
- 0002: meetup_instructions TextField on Event
- 0003: chat_channel FK on Event (to chat.Channel)

### Future Features (To Be Developed)

**Property Sale Monitoring System**:
- Goal: Alert caving community when cave properties go on sale for conservation
- Scale concern: TN has 10k+ known caves; nationwide/international requires careful architecture
- Approaches: TPAD periodic re-poll, real estate listing APIs, community flagging, tax/foreclosure watch
- Status: Tabled until cave database grows and Celery infrastructure is mature

**Remaining MVP items**:
- S3 file storage (currently local media/)
- Device-to-cloud sync mechanism
- Grotto memberships and group permissions
- Shared cave entry ownership

**Questions to Resolve**:
- Exact game engine choice for 3D exploration (deferred to Phase 4)
- Map stitching algorithm details (deferred to Phase 5)
- Hosting provider for production (AWS vs NameHero — deferred)
- Multiple cave entrances (deferred — needs schema + UI design)
- Property sale monitoring architecture at scale (deferred)
