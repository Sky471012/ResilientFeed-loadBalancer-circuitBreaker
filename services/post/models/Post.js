'use strict';

const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, required: true },
  author: { type: String, required: true },
  authorEmail: { type: String, required: true, lowercase: true },
  likes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const SAMPLE_POSTS = [
  { title: 'How Load Balancers Work', category: 'tech', author: 'Aakash', authorEmail: 'aakash@example.com', likes: 42, createdAt: daysAgo(1) },
  { title: 'Understanding Circuit Breakers', category: 'tech', author: 'Aakash', authorEmail: 'aakash@example.com', likes: 37, createdAt: daysAgo(2) },
  { title: 'Redis Pub/Sub Basics', category: 'tech', author: 'Priya', authorEmail: 'priya@example.com', likes: 25, createdAt: daysAgo(3) },
  { title: 'Interest Rates and You', category: 'business', author: 'Rahul', authorEmail: 'rahul@example.com', likes: 18, createdAt: daysAgo(2) },
  { title: 'Startup Funding in 2026', category: 'business', author: 'Priya', authorEmail: 'priya@example.com', likes: 30, createdAt: daysAgo(4) },
  { title: 'Remote Work Etiquette', category: 'business', author: 'Aakash', authorEmail: 'aakash@example.com', likes: 12, createdAt: daysAgo(5) },
  { title: 'Champions League Recap', category: 'sports', author: 'Rahul', authorEmail: 'rahul@example.com', likes: 55, createdAt: daysAgo(1) },
  { title: 'Home Workout Routines', category: 'sports', author: 'Priya', authorEmail: 'priya@example.com', likes: 21, createdAt: daysAgo(6) },
  { title: 'Minimalist Living', category: 'lifestyle', author: 'Aakash', authorEmail: 'aakash@example.com', likes: 15, createdAt: daysAgo(7) },
  { title: 'Street Food Guide', category: 'lifestyle', author: 'Priya', authorEmail: 'priya@example.com', likes: 44, createdAt: daysAgo(3) },
  { title: 'Hiking in the Himalayas', category: 'travel', author: 'Rahul', authorEmail: 'rahul@example.com', likes: 61, createdAt: daysAgo(2) },
  { title: 'Budget Travel Tips', category: 'travel', author: 'Aakash', authorEmail: 'aakash@example.com', likes: 29, createdAt: daysAgo(8) }
];

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

postSchema.statics.seedIfEmpty = async function seedIfEmpty() {
  const count = await this.countDocuments();
  if (count === 0) {
    await this.insertMany(SAMPLE_POSTS);
    console.log(`[POST] Seeded ${SAMPLE_POSTS.length} sample posts`);
  } else {
    console.log(`[POST] posts collection already has ${count} documents - skipping seed`);
  }
};

module.exports = mongoose.model('Post', postSchema, 'posts');
