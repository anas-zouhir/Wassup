import { useState } from 'react'
import { useCountryData } from '../hooks/useCountryData'
import { fetchCountryFood } from '../lib/data'
import type { CountryFeature, Dish } from '../types'
import { Panel } from './Panel'

interface Props {
  country: CountryFeature
  hasFood: boolean
  onClose: () => void
}

export function FoodPanel({ country, hasFood, onClose }: Props) {
  const { name, code } = country.properties
  const food = useCountryData(hasFood ? code : null, fetchCountryFood)

  return (
    <Panel title={name} label={`Dishes from ${name}`} onClose={onClose}>
      {!hasFood && <p className="panel-message">No dishes for {name} yet.</p>}
      {food.status === 'loading' && <p className="panel-message">Loading…</p>}
      {food.status === 'error' && <p className="panel-message">Couldn't load dishes: {food.error.message}</p>}
      {food.status === 'success' && <DishList key={code} dishes={food.data.dishes} />}
    </Panel>
  )
}

function DishList({ dishes }: { dishes: Dish[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const withRecipe = dishes.filter((d) => d.recipe).length

  return (
    <div className="dishes">
      <p className="dishes-count">
        {dishes.length} {dishes.length === 1 ? 'dish' : 'dishes'}
        {withRecipe > 0 && ` · ${withRecipe} with full recipe`}
      </p>
      <ul className="dish-list">
        {dishes.map((dish) => (
          <DishCard
            key={dish.id}
            dish={dish}
            open={openId === dish.id}
            onToggle={() => setOpenId(openId === dish.id ? null : dish.id)}
          />
        ))}
      </ul>
      <p className="attribution">
        Descriptions and photos from Wikipedia; recipes from the Wikibooks Cookbook. Both CC BY-SA.
      </p>
    </div>
  )
}

interface CardProps {
  dish: Dish
  open: boolean
  onToggle: () => void
}

function DishCard({ dish, open, onToggle }: CardProps) {
  const detailsId = `dish-${dish.id}`

  return (
    <li className={`dish${open ? ' dish-open' : ''}`}>
      <button className="dish-summary" aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
        {dish.image ? (
          <img src={dish.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="dish-placeholder" aria-hidden="true" />
        )}
        <span className="dish-text">
          <span className="dish-name">{dish.name}</span>
          {dish.localName && <span className="dish-local">{dish.localName}</span>}
          {dish.description && <span className="dish-description">{dish.description}</span>}
        </span>
        {dish.recipe && <span className="dish-badge">Recipe</span>}
      </button>

      {open && (
        <div className="dish-details" id={detailsId}>
          {dish.recipe ? (
            <>
              <h4>Ingredients</h4>
              <ul className="ingredients">
                {dish.recipe.ingredients.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
              <h4>Method</h4>
              <ol className="steps">
                {dish.recipe.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <p className="recipe-source">
                Recipe from the{' '}
                <a href={dish.recipe.source} target="_blank" rel="noopener noreferrer">
                  Wikibooks Cookbook
                </a>{' '}
                (CC BY-SA).
              </p>
            </>
          ) : (
            <p className="recipe-missing">No written recipe yet — here are some videos instead.</p>
          )}
          <div className="dish-actions">
            <a className="button" href={dish.videoSearch} target="_blank" rel="noopener noreferrer">
              ▶ Recipe videos
            </a>
            {dish.wikipedia && (
              <a className="button button-quiet" href={dish.wikipedia} target="_blank" rel="noopener noreferrer">
                Wikipedia ↗
              </a>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
