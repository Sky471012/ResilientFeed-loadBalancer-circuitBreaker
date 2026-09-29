'use strict';

const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true },
  interests: { type: [String], default: [] },
  preferredCategories: { type: [String], default: [] }
});

const SAMPLE_PROFILES = [
  {
    email: 'aakash@example.com',
    name: 'Aakash',
    interests: ['technology', 'finance'],
    preferredCategories: ['tech', 'business']
  },
  {
    email: 'priya@example.com',
    name: 'Priya',
    interests: ['travel', 'food'],
    preferredCategories: ['travel', 'lifestyle']
  },
  {
    email: 'rahul@example.com',
    name: 'Rahul',
    interests: ['sports', 'gaming'],
    preferredCategories: ['sports', 'tech']
  }
];

profileSchema.statics.seedIfEmpty = async function seedIfEmpty() {
  const count = await this.countDocuments();
  if (count === 0) {
    await this.insertMany(SAMPLE_PROFILES);
    console.log(`[PROFILE] Seeded ${SAMPLE_PROFILES.length} sample profiles`);
  } else {
    console.log(`[PROFILE] profiles collection already has ${count} documents - skipping seed`);
  }
};

module.exports = mongoose.model('Profile', profileSchema, 'profiles');
