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
- `UserProfile` - Extended profile (bio, stats, avatar)
- `Grotto` - Organization/group
- `GrottoMembership` - User → Grotto relationship

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

### Documents & Video Links
- `POST /api/caves/{id}/documents/` - Upload PDF document
- `PATCH/DELETE /api/caves/{id}/documents/{doc_id}/` - Edit/delete document
- `POST /api/caves/{id}/video-links/` - Add video link (auto-detects platform)
- `PATCH/DELETE /api/caves/{id}/video-links/{video_id}/` - Edit/delete video link

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

### Initial Development (Current)
- Windows 10 PC with WSL2
- NVIDIA RTX 4090 GPU
- Django dev server
- React dev server (Vite)
- PostgreSQL on WSL
- Cloudflare Quick Tunnel (`cloudflared`) for remote/mobile testing — `~/.local/bin/cloudflared tunnel --url http://localhost:5174`

### Production (Future)
- AWS EC2 or NameHero VPS
- NVIDIA GPU instance (for 3D processing)
- Nginx reverse proxy
- Gunicorn WSGI server
- PostgreSQL RDS or managed database
- S3 or object storage for files
- CloudFront CDN for static assets

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
- `DEPLOY.md` - Deployment instructions (TBD)

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

**Date**: 2026-02-20
**Status**: Active development — core features operational

### What's Built

**Backend (Django)**:
- Full Cave CRUD with UUID primary keys, visibility levels (public/limited_public/unlisted/private), collaboration settings
- Permission enforcement on edit/delete: owner or `is_staff` only (401/403 responses)
- LandOwner model with TN GIS parcel integration (ArcGIS + TPAD API)
- Three-tier GIS data visibility: always-visible (TPAD link, polygon, GIS Map), mutable (owner name, address, acreage), hidden (contact info)
- `gis_fields_visible` toggle on LandOwner — cave entry creator controls tier-2 field visibility
- CaveRequest model with accept/deny lifecycle for contact access requests and contact info submissions
- `contact_access_users` M2M on LandOwner for granular per-user contact visibility grants
- User auth with registration, login, JWT tokens
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
- CSV import: CLI management command + admin-only web UI with two-phase flow (preview + apply)
- Coordinate-based duplicate detection (Haversine distance) with conflict resolution (keep/replace/rename)
- Universal coordinate parser (decimal, DMS, UTM, MGRS, Google/Apple Maps URLs)
- Google Maps short URL resolver (server-side redirect following)
- Reverse geocode endpoint (Nominatim) — auto-fills city, state, country, zip from coordinates
- Proximity check endpoint — warns about existing caves within ~50m at creation time
- Visibility-filtered `cave_list` API — unlisted/private caves hidden from non-owners
- Title case auto-normalization for cave names and aliases on save
- `is_staff` exposed via UserProfileSerializer for frontend admin gating

**Frontend (React/Vite)**:
- Cyberpunk-themed UI with dark mode
- Explore page with searchable cave list + surface map + sort/filter (stars, mapped, unmapped, needs details, activity)
  - Search by name, city, state, zip code, aliases
  - Admin-only CSV bulk import modal (drag/drop, proximity duplicate detection, conflict resolution UI)
  - Marker clustering (leaflet.markercluster) with cyberpunk-themed cluster icons
  - Map auto-pans/zooms to fit filtered search results
  - Map view persistence via sessionStorage (restored on back-navigation)
  - Default US center with fitBounds auto-zoom to markers
  - Cave cards show aliases in parentheses after name
- Cave detail page with:
  - 2D interactive cave map (multi-level, POIs, route overlay, 7 render modes)
  - 3D cave explorer (Three.js point cloud viewer)
  - Surface map with Leaflet (cave markers, parcel polygon overlay, cave map overlay, survey map overlays, center-on-cave button, zoom to level 21)
  - Survey map overlay system: guided 4-step ingestion modal (upload → pin entrance → set scale → orient & confirm), show/hide toggle, multi-survey selector dropdown, edit/delete, rotation-aware auto-fit
  - Google Earth-style floating collapsible panel on surface map with mode selector, level selector, opacity control
  - CaveMapOverlay supports all 7 modes: walls (quick/standard/detailed/raw_slice), edges (amber), heatmap (inferno colormap image), points (density circles)
  - Tabbed Media section (Photos / Documents / Videos) replacing standalone photo gallery
  - Photo tab: gallery with carousel, upload dialog, camera capture
  - Documents tab: PDF upload with drag-and-drop, in-app PDF viewer (blob URL + iframe), delete
  - Videos tab: URL-based video links with auto platform detection, thumbnail grid with play overlay, full-screen embedded playback (YouTube/Vimeo/TikTok), fallback to external link for unsupported platforms
  - Wiki description editor with rich text (TipTap)
  - Star ratings and reviews
  - Property owner section with GIS lookup, visibility toggle, contact info tiers
  - CaveRequest system: request contact access, submit contact info, pending requests with accept/deny for cave owners
  - Inline coordinate editor (accepts any format)
  - Inline alias editor for cave owners/admins
  - Edit and Delete buttons in topbar (owner or admin only)
  - Delete confirmation modal with permanent deletion warning
  - Unlisted visibility badge (purple)
- Create Cave page with smart coordinate input, reverse geocode auto-fill (city/state/country/zip), proximity duplicate warning (~50m), aliases, unlisted visibility option
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
| `caves/csv_import.py` | Shared CSV parsing + Haversine duplicate detection |
| `caves/gis_lookup.py` | TN GIS parcel lookup (ArcGIS + TPAD) |
| `caves/hand_drawn_map.py` | Survey map image processing (bg removal + recolor) |
| `caves/models.py` | Cave, LandOwner, CavePhoto (SET_NULL + uploaded_by), DescriptionRevision, CavePermission, CaveShareLink, CaveRequest, SurveyMap, CaveDocument (SET_NULL), CaveVideoLink (SET_NULL), MediaVisibility |
| `caves/video_utils.py` | Video URL parser (platform detect, embed URL, thumbnail generation) |
| `caves/serializers.py` | Full/Public/Muted serializers with tier-based redaction + CaveRequestSerializer + SurveyMapSerializer + CaveDocumentSerializer + CaveVideoLinkSerializer |
| `caves/views.py` | Cave CRUD (owner/admin perms), GIS lookup, reverse geocode, proximity check, map data, photo upload, request lifecycle, CSV import, survey map CRUD, document upload, video link CRUD, user_media + user_media_update |
| `frontend/src/pages/CaveDetail.jsx` | Main cave profile page (~1800 lines) |
| `frontend/src/components/CaveMapOverlay.jsx` | SLAM-to-LatLng overlay on Leaflet (all 7 modes) |
| `frontend/src/components/SurfaceMap.jsx` | Leaflet map with markers, clustering, parcel polygon, cave overlay, survey overlays, center button |
| `frontend/src/components/HandDrawnMapOverlay.jsx` | Multi-survey Leaflet image overlays with lock/edit mode |
| `frontend/src/components/SurveyMapModal.jsx` | 4-step guided survey map ingestion modal |
| `frontend/src/components/DocumentUploadModal.jsx` | PDF upload dialog with drag-and-drop |
| `frontend/src/components/DocumentViewer.jsx` | Full-screen PDF viewer (blob URL + iframe) |
| `frontend/src/components/VideoLinkModal.jsx` | Add video URL dialog with platform auto-detect + preview |
| `frontend/src/components/VideoEmbed.jsx` | Full-screen video embed with platform-specific iframe |
| `frontend/src/utils/videoUtils.js` | Client-side video URL parser (mirrors backend) |
| `frontend/src/components/CsvImportModal.jsx` | Three-step admin CSV import modal (upload → preview/resolve → results) |
| `frontend/src/utils/parseCoordinates.js` | Universal coordinate format parser |
| `frontend/src/components/PostCard.jsx` | Wall post card with soft delete, cave status badges, reactions, comments |
| `social/views.py` | Wall posts (soft delete + cave_name_cache), ratings, activity feed |
| `users/views.py` | Auth, profile, avatar presets |

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

### Migrations (social app)
- 0001: Initial social models
- 0002: Post soft delete fields (is_deleted, deleted_at, cave_name_cache)
- 0003: Data migration — backfill cave_name_cache on existing posts

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
- Property sale monitoring architecture at scale (deferred)
