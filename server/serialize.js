import { placeSummary } from './catalog.js';

export const publicUser = (u) => ({
  username: u.username,
  displayName: u.display_name,
  bio: u.bio,
  createdAt: u.created_at,
});

export const privateUser = (u) => ({ ...publicUser(u), email: u.email });

export const log = (r) => ({
  type: r.place_type,
  code: r.place_code,
  visited: !!r.visited,
  wishlist: !!r.wishlist,
  liked: !!r.liked,
  rating: r.rating ?? null,
  review: r.review ?? null,
  visitedOn: r.visited_on ?? null,
  reviewAt: r.review_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Reseña con usuario y lugar (filas con columnas de logs + username/display_name). */
export const review = (r) => ({
  id: r.id,
  user: { username: r.username, displayName: r.display_name },
  place: placeSummary(r.place_type, r.place_code),
  rating: r.rating ?? null,
  review: r.review ?? null,
  liked: !!r.liked,
  visitedOn: r.visited_on ?? null,
  reviewAt: r.review_at ?? r.updated_at,
});
