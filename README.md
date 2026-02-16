# Cave Backend - Cloud Service for Cave Mapper Ecosystem

A cloud-hosted Django web service providing synchronization, social media, and computational services for the Cave Mapper portable mapping devices.

## What is Cave Backend?

Cave Backend is the **cloud component** of the Cave Mapper ecosystem:

- **cave-mapper**: Portable Orange Pi device with LiDAR for cave mapping
- **cave-server**: Local Django server running ON the device (for in-cave collaboration)
- **cave-backend**: THIS PROJECT - Cloud service for sync, social features, and GPU processing

## Key Features

### MVP (Current Phase)
- ✅ Google OAuth authentication
- ✅ Device registration via QR code
- ✅ Automatic WiFi sync with cave-server instances
- ✅ Cave repository (public/private caves)
- ✅ Permission system (owner/editor/viewer roles)
- ✅ Social features (comments, photos, wiki-style descriptions)
- ✅ Grotto memberships (organizations)

### Future Phases
- 🔄 3D mesh generation from point clouds (GPU-accelerated)
- 🔄 Browser-based virtual cave exploration (game engine)
- 🔄 Map stitching (merge multi-expedition maps)
- 🔄 Advanced social features (messaging, feeds, ratings)

## Technology Stack

- **Backend**: Django 4.2+ / Python 3.10+
- **Database**: PostgreSQL
- **API**: Django REST Framework
- **Auth**: Google OAuth (django-allauth)
- **Storage**: S3-compatible object storage
- **Frontend**: React 18 + Vite
- **Processing**: Celery + Redis (for background jobs)
- **GPU**: NVIDIA CUDA (for 3D generation)

## Quick Start

```bash
# Clone repository
git clone https://github.com/x78163/cave-backend.git
cd cave-backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up database
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Run development server
python manage.py runserver
```

## Project Structure

```
cave-backend/
├── CLAUDE.md              # AI continuity document (comprehensive context)
├── README.md              # This file
├── ARCHITECTURE.md        # System design deep-dive
├── MVP_PLAN.md            # Phase 1 development plan
├── DATABASE_SCHEMA.md     # Database design
├── API_SPEC.md            # REST API specification
├── requirements.txt       # Python dependencies
├── manage.py              # Django management script
├── cave_backend/          # Django project settings
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py
├── users/                 # User management app
├── devices/               # Device registration app
├── caves/                 # Cave data app
├── sync/                  # Sync mechanism app
├── social/                # Social features app
└── processing/            # 3D processing app (future)
```

## Documentation

For comprehensive project context, see:

- **[CLAUDE.md](CLAUDE.md)** - Complete AI continuity document (start here!)
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture and design decisions
- **[MVP_PLAN.md](MVP_PLAN.md)** - Phase 1 development roadmap
- **[DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)** - Database models and relationships
- **[API_SPEC.md](API_SPEC.md)** - REST API endpoint specifications

## Development Workflow

1. **Branch from main**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes and test**
   ```bash
   python manage.py test
   ```

3. **Commit with descriptive messages**
   ```bash
   git add .
   git commit -m "Add user authentication with Google OAuth"
   ```

4. **Push and create pull request**
   ```bash
   git push origin feature/your-feature-name
   ```

## Deployment

### Initial Development
- Windows 10 PC with WSL2
- NVIDIA RTX 4090 GPU
- Local PostgreSQL

### Production (Future)
- AWS EC2 or NameHero VPS
- NVIDIA GPU instance
- Managed PostgreSQL (RDS)
- S3 for file storage
- CloudFront CDN

## Related Projects

- **cave-mapper**: https://github.com/x78163/cave-mapper
- **cave-server**: https://github.com/x78163/cave-server

## License

TBD

## Contact

For questions or contributions, please open an issue on GitHub.
