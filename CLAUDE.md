# Cave Backend - AI Continuity Document

## Project Overview

**Cave Backend** is a cloud-hosted Django web service that provides synchronization, social media, and computational services for the Cave Mapper ecosystem. It acts as the central repository and processing hub for cave mapping data collected by portable Orange Pi-based cave-mapper devices.

**Current Status**: Project initialization - continuity documents created, ready for development

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
- `DELETE /api/caves/{id}/` - Delete cave (owner only)
- `POST /api/caves/{id}/share/` - Generate share link/QR

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

3. **Private**
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

**Date**: 2026-02-16
**Status**: Project initialization
**Next Steps**:
1. Create Django project structure
2. Set up PostgreSQL database
3. Implement Google OAuth
4. Create initial models (User, Device, Cave)
5. Build sync API endpoints
6. Test with mock cave-server client

**Questions to Resolve**:
- Exact game engine choice for 3D exploration (deferred to Phase 4)
- Map stitching algorithm details (deferred to Phase 5)
- Hosting provider for production (AWS vs NameHero - deferred)
