import mongoose from 'mongoose';

/**
 * Job Schema
 * ──────────
 * Stores structured government job listings after Gemini parsing.
 * Each document represents one unique vacancy identified primarily by
 * officialApplicationUrl and secondarily by listingFingerprint.
 */
const jobSchema = new mongoose.Schema(
  {
    shortTitle: {
      type: String,
      required: [true, 'shortTitle is required'],
      trim: true,
    },
    department: {
      type: String,
      required: [true, 'department is required'],
      trim: true,
    },
    eligibilityCriteria: {
      type: String,
      default: 'Not specified',
      trim: true,
    },
    qualification: {
      type: String,
      default: 'Not specified',
      trim: true,
    },
    vacancies: {
      type: String,
      default: 'Not specified',
      trim: true,
    },
    salary: {
      type: String,
      default: 'Not specified',
      trim: true,
    },
    ageLimit: {
      type: String,
      default: 'Not specified',
      trim: true,
    },
    officialNotificationPdf: {
      type: String,
      default: 'Not specified',
      trim: true,
    },
    jobLocation: {
      type: String,
      default: 'Not specified',
      trim: true,
    },
    applicationDeadline: {
      type: String,
      default: 'Not specified',
      trim: true,
    },
    officialApplicationUrl: {
      type: String,
      required: [true, 'officialApplicationUrl is required'],
      trim: true,
    },
    listingFingerprint: {
      type: String,
      required: true,
      index: true,
    },
    sourceSiteId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

jobSchema.index({ officialApplicationUrl: 1 }, { unique: true, sparse: true });

const Job = mongoose.model('Job', jobSchema);

export default Job;
