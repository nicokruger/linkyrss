function remove_attr (x)
  if x.attr then
    x.attr = pandoc.Attr()
  end
  if x.src then
    x.src = ""
  end
  if x.href then
    --x.href = ""
  end
  if x.target then
    --x.target = ""
  end
  --print(pandoc.utils.stringify(x))
  return x
end

return {{Inline = remove_attr, Block = remove_attr}}
