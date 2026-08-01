# 🚦 VisionGuard AI

**Intelligent Traffic Monitoring & Automated Violation Detection System**

VisionGuard AI is a smart surveillance platform that uses Computer Vision and Machine Learning to automatically detect vehicles, track speeds, and log traffic violations in real time. 

This repository contains the **Minimum Viable Product (MVP)**, focusing on core speed violation detection using a privacy-first approach (only data of violating vehicles is stored).

---

## ✨ Features (MVP)

*   **Real-Time Vehicle Detection:** Identifies cars, trucks, and motorcycles using YOLOv11.
*   **Persistent Tracking:** Tracks individual vehicles across frames using ByteTrack.
*   **Speed Estimation:** Calculates real-world speed across designated camera reference zones.
*   **Privacy-First Logging:** Video of law-abiding drivers is processed in memory and instantly discarded. Only snapshots of violators are saved to the database.
*   **Live Dashboard:** A React-based UI to view the live processed video feed and a real-time log of traffic violations.

---

## 🛠️ Technology Stack

**AI & Computer Vision**
*   Python 3.10+
*   OpenCV (Video processing & bounding boxes)
*   YOLOv11 (Object detection)
*   ByteTrack (Object tracking)

**Backend & Database**
*   FastAPI (High-performance API and video streaming)
*   SQLite (Lightweight local database for MVP phase)
*   SQLAlchemy (ORM)

**Frontend**
*   React + Vite
*   Tailwind CSS
